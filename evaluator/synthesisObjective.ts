import {
  TIMEOUT,
  buildImeSessionPlan,
  evaluateImeScenarios,
  type DetectionPolicy,
  type PlannedSessionEvent,
  type SessionEvaluationOptions,
  type SessionScenarioResult,
} from "./evaluateImeSession";
import { ILLEGAL, type InferenceFunction } from "./evaluateInference";

/**
 * Minimize this tuple lexicographically, from left to right.
 *
 * A hardFailureFlag of 1 makes a program ineligible regardless of every later
 * component. The remaining failure fields provide a deterministic search
 * gradient among ineligible proposals; they do not turn failure into a soft
 * penalty.
 */
export type SynthesisObjective = readonly [
  hardFailureFlag: number,
  failedScenarioRuns: number,
  illegalScenarioRuns: number,
  timeoutScenarioRuns: number,
  freeRunningSyllableErrors: number,
  worstCorrectingPolicyPhysicalActions: number,
  totalCorrectingPhysicalActions: number,
  p95ErrorCascadeLength: number,
  totalCandidateInspectionSteps: number,
  p95InferenceLatencyMilliseconds: number,
  artifactBytes: number,
];

export interface SynthesisObjectiveOptions {
  artifactBytes?: number;
}

export interface SynthesisMeasureOptions
  extends
    Omit<SessionEvaluationOptions, "policy" | "plan">,
    SynthesisObjectiveOptions {
  policies?: readonly DetectionPolicy[];
}

export interface SynthesisMeasureDetails {
  objective: SynthesisObjective;
  scenarios: SessionScenarioResult[];
}

export interface PreparedSynthesisText {
  text: string;
  plan: readonly PlannedSessionEvent[];
}

export type SynthesisCorpus =
  string | readonly string[] | readonly PreparedSynthesisText[];

const policyKey = (policy: DetectionPolicy): string => {
  switch (policy.kind) {
    case "after-v7":
      return `after-v7:${policy.delay}`;
    default:
      return policy.kind;
  }
};

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? sorted[0];
};

/**
 * Aggregate paired session scenarios into the total order used by program
 * synthesis. The benchmark must contain at least one free-running (`never`)
 * run and one correcting-policy run.
 */
export function buildSynthesisObjective(
  scenarios: readonly SessionScenarioResult[],
  options: SynthesisObjectiveOptions = {},
): SynthesisObjective {
  if (scenarios.length === 0) {
    throw new RangeError("At least one session scenario is required.");
  }
  const artifactBytes = options.artifactBytes ?? 0;
  if (!Number.isInteger(artifactBytes) || artifactBytes < 0) {
    throw new RangeError("artifactBytes must be a non-negative integer.");
  }

  let illegalRuns = 0;
  let timeoutRuns = 0;
  let freeRunningRuns = 0;
  let freeRunningErrors = 0;
  let totalCorrectingActions = 0;
  let candidateInspectionSteps = 0;
  const correctingActionsByPolicy = new Map<string, number>();
  const cascades: number[] = [];
  const latencies: number[] = [];

  for (const { policy, result } of scenarios) {
    if (result.failure === ILLEGAL) illegalRuns += 1;
    if (result.failure === TIMEOUT) timeoutRuns += 1;
    cascades.push(...result.metrics.errorCascades);
    for (const step of result.trace) {
      if (step.latencyMs !== null) latencies.push(step.latencyMs);
    }

    if (policy.kind === "never") {
      freeRunningRuns += 1;
      freeRunningErrors += result.metrics.finalSyllableErrors;
      continue;
    }

    const key = policyKey(policy);
    const actions = result.metrics.physicalActions;
    correctingActionsByPolicy.set(
      key,
      (correctingActionsByPolicy.get(key) ?? 0) + actions,
    );
    totalCorrectingActions += actions;
    candidateInspectionSteps += result.actions.candidateInspectionSteps;
  }

  if (freeRunningRuns === 0) {
    throw new RangeError(
      "The synthesis objective requires a free-running (`never`) scenario.",
    );
  }
  if (correctingActionsByPolicy.size === 0) {
    throw new RangeError(
      "The synthesis objective requires at least one correcting policy.",
    );
  }

  const failedRuns = illegalRuns + timeoutRuns;
  return [
    failedRuns > 0 ? 1 : 0,
    failedRuns,
    illegalRuns,
    timeoutRuns,
    freeRunningErrors,
    Math.max(...correctingActionsByPolicy.values()),
    totalCorrectingActions,
    percentile(cascades, 0.95),
    candidateInspectionSteps,
    Math.ceil(percentile(latencies, 0.95)),
    artifactBytes,
  ];
}

/** Return -1 when left is better, 1 when right is better, and 0 on a tie. */
export function compareSynthesisObjectives(
  left: SynthesisObjective,
  right: SynthesisObjective,
): -1 | 0 | 1 {
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] as number;
    const rightValue = right[index] as number;
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return 0;
}

/**
 * The single program-synthesis measure: replay a text or fixed corpus under
 * every requested user policy and return one lexicographically ordered tuple.
 */
export async function evaluateSynthesisMeasure(
  textOrCorpus: SynthesisCorpus,
  inference: InferenceFunction,
  options: SynthesisMeasureOptions = {},
): Promise<SynthesisObjective> {
  return (
    await evaluateSynthesisMeasureDetailed(textOrCorpus, inference, options)
  ).objective;
}

/** The same measure plus scenario traces for explaining an objective change. */
export async function evaluateSynthesisMeasureDetailed(
  textOrCorpus: SynthesisCorpus,
  inference: InferenceFunction,
  options: SynthesisMeasureOptions = {},
): Promise<SynthesisMeasureDetails> {
  const {
    policies,
    artifactBytes,
    candidateLimit,
    maxSyllablesPerV7Island,
    inferenceTimeoutMs,
    weights,
    actionTimeMs,
  } = options;
  const corpus = prepareSynthesisCorpus(
    textOrCorpus,
    maxSyllablesPerV7Island ?? 2,
  );
  if (corpus.length === 0) {
    throw new RangeError(
      "The synthesis corpus must contain at least one text.",
    );
  }

  const scenarios: SessionScenarioResult[] = [];
  for (const { text, plan } of corpus) {
    scenarios.push(
      ...(await evaluateImeScenarios(text, inference, {
        plan,
        ...(policies ? { policies } : {}),
        ...(candidateLimit === undefined ? {} : { candidateLimit }),
        ...(maxSyllablesPerV7Island === undefined
          ? {}
          : { maxSyllablesPerV7Island }),
        ...(inferenceTimeoutMs === undefined ? {} : { inferenceTimeoutMs }),
        ...(weights === undefined ? {} : { weights }),
        ...(actionTimeMs === undefined ? {} : { actionTimeMs }),
      })),
    );
  }
  return {
    objective: buildSynthesisObjective(scenarios, { artifactBytes }),
    scenarios,
  };
}

/**
 * Segment a fixed benchmark once, then reuse it for every proposal in a
 * synthesis run. Passing an already prepared corpus is a no-op.
 */
export function prepareSynthesisCorpus(
  textOrCorpus: SynthesisCorpus,
  maxSyllablesPerV7Island = 2,
): PreparedSynthesisText[] {
  const corpus =
    typeof textOrCorpus === "string" ? [textOrCorpus] : [...textOrCorpus];
  return corpus.map((item) =>
    typeof item === "string"
      ? {
          text: item,
          plan: buildImeSessionPlan(item, maxSyllablesPerV7Island),
        }
      : { text: item.text, plan: item.plan },
  );
}
