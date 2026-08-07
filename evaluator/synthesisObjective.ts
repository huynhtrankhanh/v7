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

const histogramPercentile = (
  histogram: ReadonlyMap<number, number>,
  count: number,
  fraction: number,
): number => {
  if (count === 0) return 0;
  const target = Math.ceil(count * fraction);
  let cumulative = 0;
  for (const [value, occurrences] of [...histogram].sort(
    ([left], [right]) => left - right,
  )) {
    cumulative += occurrences;
    if (cumulative >= target) return value;
  }
  return 0;
};

class SynthesisObjectiveAccumulator {
  private scenarioRuns = 0;
  private illegalRuns = 0;
  private timeoutRuns = 0;
  private freeRunningRuns = 0;
  private freeRunningErrors = 0;
  private totalCorrectingActions = 0;
  private candidateInspectionSteps = 0;
  private cascadeCount = 0;
  private latencyCount = 0;
  private readonly correctingActionsByPolicy = new Map<string, number>();
  private readonly cascadeHistogram = new Map<number, number>();
  private readonly latencyHistogram = new Map<number, number>();

  add({ policy, result }: SessionScenarioResult): void {
    this.scenarioRuns += 1;
    if (result.failure === ILLEGAL) this.illegalRuns += 1;
    if (result.failure === TIMEOUT) this.timeoutRuns += 1;
    for (const cascade of result.metrics.errorCascades) {
      this.cascadeCount += 1;
      this.cascadeHistogram.set(
        cascade,
        (this.cascadeHistogram.get(cascade) ?? 0) + 1,
      );
    }
    for (const step of result.trace) {
      if (step.latencyMs === null) continue;
      // Ceil is monotonic, so nearest-rank percentile(ceil(x)) is exactly
      // ceil(nearest-rank percentile(x)), while giving the histogram bounded
      // integer keys instead of retaining every trace sample.
      const latency = Math.ceil(step.latencyMs);
      this.latencyCount += 1;
      this.latencyHistogram.set(
        latency,
        (this.latencyHistogram.get(latency) ?? 0) + 1,
      );
    }

    if (policy.kind === "never") {
      this.freeRunningRuns += 1;
      this.freeRunningErrors += result.metrics.finalSyllableErrors;
      return;
    }

    const key = policyKey(policy);
    const actions = result.metrics.physicalActions;
    this.correctingActionsByPolicy.set(
      key,
      (this.correctingActionsByPolicy.get(key) ?? 0) + actions,
    );
    this.totalCorrectingActions += actions;
    this.candidateInspectionSteps += result.actions.candidateInspectionSteps;
  }

  finish(options: SynthesisObjectiveOptions = {}): SynthesisObjective {
    if (this.scenarioRuns === 0) {
      throw new RangeError("At least one session scenario is required.");
    }
    const artifactBytes = options.artifactBytes ?? 0;
    if (!Number.isInteger(artifactBytes) || artifactBytes < 0) {
      throw new RangeError("artifactBytes must be a non-negative integer.");
    }
    if (this.freeRunningRuns === 0) {
      throw new RangeError(
        "The synthesis objective requires a free-running (`never`) scenario.",
      );
    }
    if (this.correctingActionsByPolicy.size === 0) {
      throw new RangeError(
        "The synthesis objective requires at least one correcting policy.",
      );
    }

    const failedRuns = this.illegalRuns + this.timeoutRuns;
    return [
      failedRuns > 0 ? 1 : 0,
      failedRuns,
      this.illegalRuns,
      this.timeoutRuns,
      this.freeRunningErrors,
      Math.max(...this.correctingActionsByPolicy.values()),
      this.totalCorrectingActions,
      histogramPercentile(this.cascadeHistogram, this.cascadeCount, 0.95),
      this.candidateInspectionSteps,
      histogramPercentile(this.latencyHistogram, this.latencyCount, 0.95),
      artifactBytes,
    ];
  }
}

/**
 * Aggregate paired session scenarios into the total order used by program
 * synthesis. The benchmark must contain at least one free-running (`never`)
 * run and one correcting-policy run.
 */
export function buildSynthesisObjective(
  scenarios: readonly SessionScenarioResult[],
  options: SynthesisObjectiveOptions = {},
): SynthesisObjective {
  const accumulator = new SynthesisObjectiveAccumulator();
  for (const scenario of scenarios) accumulator.add(scenario);
  return accumulator.finish(options);
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
  const corpus =
    typeof textOrCorpus === "string" ? [textOrCorpus] : textOrCorpus;
  const accumulator = new SynthesisObjectiveAccumulator();
  let textCount = 0;
  for (const item of corpus) {
    textCount += 1;
    const prepared =
      typeof item === "string"
        ? {
            text: item,
            plan: buildImeSessionPlan(
              item,
              options.maxSyllablesPerV7Island ?? 2,
            ),
          }
        : item;
    const scenarios = await evaluateImeScenarios(
      prepared.text,
      inference,
      scenarioOptions(prepared.plan, options),
    );
    for (const scenario of scenarios) accumulator.add(scenario);
  }
  if (textCount === 0) {
    throw new RangeError(
      "The synthesis corpus must contain at least one text.",
    );
  }
  return accumulator.finish({ artifactBytes: options.artifactBytes });
}

const scenarioOptions = (
  plan: readonly PlannedSessionEvent[],
  options: SynthesisMeasureOptions,
): SessionEvaluationOptions & { policies?: readonly DetectionPolicy[] } => ({
  plan,
  ...(options.policies ? { policies: options.policies } : {}),
  ...(options.candidateLimit === undefined
    ? {}
    : { candidateLimit: options.candidateLimit }),
  ...(options.maxSyllablesPerV7Island === undefined
    ? {}
    : { maxSyllablesPerV7Island: options.maxSyllablesPerV7Island }),
  ...(options.inferenceTimeoutMs === undefined
    ? {}
    : { inferenceTimeoutMs: options.inferenceTimeoutMs }),
  ...(options.weights === undefined ? {} : { weights: options.weights }),
  ...(options.actionTimeMs === undefined
    ? {}
    : { actionTimeMs: options.actionTimeMs }),
});

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
