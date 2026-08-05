import { getV7Code } from "../src/v7Core";
import {
  buildEvaluationIslands,
  ILLEGAL,
  type InferenceCandidate,
  type InferenceFunction,
} from "./evaluateInference";

export const TIMEOUT = "TIMEOUT" as const;
export type SessionFailure = typeof ILLEGAL | typeof TIMEOUT;

export type DetectionPolicy =
  | { kind: "never" }
  | { kind: "immediate" }
  | { kind: "after-v7"; delay: number }
  | { kind: "clause" }
  | { kind: "end" };

export const DEFAULT_DETECTION_POLICIES: readonly DetectionPolicy[] = [
  { kind: "never" },
  { kind: "immediate" },
  { kind: "after-v7", delay: 1 },
  { kind: "after-v7", delay: 3 },
  { kind: "after-v7", delay: 5 },
  { kind: "clause" },
  { kind: "end" },
];

export interface SessionActionWeights {
  v7Entry: number;
  fixedEntry: number;
  candidateSelection: number;
  candidateInspectionStep: number;
  piecemealEntry: number;
  piecemealReplacement: number;
  commit: number;
  cursorMove: number;
  selectionExtension: number;
  deletion: number;
  deterministicRetype: number;
}

export interface SessionEvaluationOptions {
  policy?: DetectionPolicy;
  candidateLimit?: number;
  maxSyllablesPerV7Island?: number;
  inferenceTimeoutMs?: number;
  weights?: Partial<SessionActionWeights>;
  /** Reuse a plan across paired policies to avoid repeated segmentation. */
  plan?: readonly PlannedSessionEvent[];
  /** Optional measured milliseconds per operation. No time estimate is
   * produced unless this is supplied. */
  actionTimeMs?: Partial<SessionActionWeights>;
}

export interface SessionActionCounts {
  v7Entries: number;
  fixedEntries: number;
  candidateSelections: number;
  combinedCandidateSelections: number;
  candidateInspectionSteps: number;
  piecemealEntries: number;
  piecemealReplacements: number;
  commits: number;
  cursorMoves: number;
  selectionExtensions: number;
  deletions: number;
  deterministicRetypes: number;
}

export type PlannedSessionEvent =
  | {
      kind: "v7";
      sourceText: string;
      targetText: string;
      targetSyllables: string[];
      v7Code: string;
    }
  | {
      kind: "fixed";
      sourceText: string;
      targetText: string;
      inputActions: number;
      automaticSpacing: boolean;
      autoAcceptsPreview: boolean;
      clauseBoundary: boolean;
      commitBoundary: boolean;
    };

export type RecoveryStrategy =
  | "candidate-selection"
  | "piecemeal"
  | "external-editor"
  | "piecemeal-and-external-editor";

export interface SessionRecovery {
  strategy: RecoveryStrategy;
  combinedWithNextEntry: boolean;
  selectedCandidateRank: number | null;
  piecemealRanges: Array<{ start: number; end: number }>;
  externalRanges: Array<{ start: number; end: number }>;
  detectionDelayV7Entries: number;
}

export interface SessionTraceStep {
  eventIndex: number;
  event: PlannedSessionEvent | { kind: "final-detection" };
  targetText: string;
  request: string[] | null;
  visibleCandidates: string[];
  previewText: string;
  latencyMs: number | null;
  recovery: SessionRecovery | null;
  cumulativeActions: SessionActionCounts;
}

export interface SessionMetrics {
  physicalActions: number;
  interactionCost: number;
  estimatedTimeMs?: number;
  finalSyllableErrors: number;
  finalSyllableErrorRate: number;
  finalTextExact: boolean;
  errorCascades: number[];
  meanCascadeLength: number;
  p95CascadeLength: number;
  propagatingCascadeRate: number;
  recoveryDistancesV7Entries: number[];
  meanRecoveryDistanceV7Entries: number;
  selectedCandidateRanks: number[];
  meanSelectedCandidateRank: number;
  inferenceCalls: number;
  inferenceLatencyP50Ms: number;
  inferenceLatencyP95Ms: number;
  inferenceLatencyMaxMs: number;
}

export interface SessionEvaluationResult {
  failure: SessionFailure | null;
  policy: DetectionPolicy;
  targetText: string;
  finalText: string;
  representableSyllables: number;
  actions: SessionActionCounts;
  metrics: SessionMetrics;
  trace: SessionTraceStep[];
}

export interface SessionScenarioResult {
  policy: DetectionPolicy;
  result: SessionEvaluationResult;
}

type FixedPart = { kind: "fixed"; value: string };
type V7Part = {
  kind: "v7";
  value: string;
  targetSyllables: string[];
};
type SessionPart = FixedPart | V7Part;

interface RenderedCandidate {
  replacements: string[];
  text: string;
}

interface MutableSessionState {
  parts: SessionPart[];
  targetText: string;
  candidates: RenderedCandidate[];
  v7Entries: number;
  firstErrorAtV7Entry: number | null;
  activeCascadeLength: number;
  cascadeLengths: number[];
  recoveryDistances: number[];
  selectedCandidateRanks: number[];
  actions: SessionActionCounts;
  latencies: number[];
}

const DEFAULT_WEIGHTS: SessionActionWeights = {
  v7Entry: 1,
  fixedEntry: 1,
  candidateSelection: 1,
  candidateInspectionStep: 0,
  piecemealEntry: 1,
  piecemealReplacement: 1,
  commit: 1,
  cursorMove: 1,
  selectionExtension: 1,
  deletion: 1,
  deterministicRetype: 1,
};

const clausePunctuation = new Set([",", ";", ":", ".", "!", "?"]);
const autoAcceptPunctuation = new Set([".", ",", "!", "?"]);

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
};

const nonNegativeNumber = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`);
  }
  return value;
};

const resolveWeights = (
  partial: Partial<SessionActionWeights> | undefined,
  name = "weights",
  defaults: SessionActionWeights = DEFAULT_WEIGHTS,
): SessionActionWeights => {
  const weights = { ...defaults, ...partial };
  return Object.fromEntries(
    Object.entries(weights).map(([key, value]) => [
      key,
      nonNegativeNumber(value, `${name}.${key}`),
    ]),
  ) as unknown as SessionActionWeights;
};

const emptyActions = (): SessionActionCounts => ({
  v7Entries: 0,
  fixedEntries: 0,
  candidateSelections: 0,
  combinedCandidateSelections: 0,
  candidateInspectionSteps: 0,
  piecemealEntries: 0,
  piecemealReplacements: 0,
  commits: 0,
  cursorMoves: 0,
  selectionExtensions: 0,
  deletions: 0,
  deterministicRetypes: 0,
});

const cloneActions = (actions: SessionActionCounts): SessionActionCounts => ({
  ...actions,
});

const normalizeText = (value: string): string =>
  value.normalize("NFC").toLocaleLowerCase("vi");

const sameText = (left: string, right: string): boolean =>
  normalizeText(left) === normalizeText(right);

const wordTokens = (value: string): string[] =>
  [
    ...new Intl.Segmenter("vi", { granularity: "word" }).segment(
      normalizeText(value),
    ),
  ]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? sorted[0];
};

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;

const editDistance = (left: readonly string[], right: readonly string[]) => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(
        Math.min(
          (current[rightIndex] ?? 0) + 1,
          (previous[rightIndex + 1] ?? 0) + 1,
          (previous[rightIndex] ?? 0) +
            (left[leftIndex] === right[rightIndex] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? left.length;
};

/**
 * Build a deterministic corpus replay plan. Representable Vietnamese words use
 * predictive V7 islands. Ordinary single spaces are emitted by the IME spacing
 * rules and cost no stroke; punctuation, layout, and fallback graphemes are
 * explicit fixed-entry events.
 */
export function buildImeSessionPlan(
  text: string,
  maxSyllablesPerV7Island = 2,
): PlannedSessionEvent[] {
  positiveInteger(maxSyllablesPerV7Island, "maxSyllablesPerV7Island");
  const islands = buildEvaluationIslands(text, maxSyllablesPerV7Island);
  const v7Starts = new Set(islands.map((island) => island.sourceStart));
  const v7Ends = new Set(islands.map((island) => island.sourceEnd));
  const events: PlannedSessionEvent[] = [];
  let cursor = 0;

  const appendFixed = (fixedText: string, sourceOffset: number): void => {
    for (const part of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(fixedText)) {
      const value = part.segment;
      const absoluteStart = sourceOffset + part.index;
      const absoluteEnd = absoluteStart + value.length;
      const touchesV7Boundary =
        v7Ends.has(absoluteStart) || v7Starts.has(absoluteEnd);
      const automaticSpacing =
        value === " " &&
        absoluteStart > 0 &&
        absoluteEnd < text.length &&
        !/\s/u.test(text[absoluteStart - 1] ?? "") &&
        !/\s/u.test(text[absoluteEnd] ?? "") &&
        touchesV7Boundary;
      events.push({
        kind: "fixed",
        sourceText: value,
        targetText: value,
        inputActions: automaticSpacing ? 0 : 1,
        automaticSpacing,
        autoAcceptsPreview: autoAcceptPunctuation.has(value) || value === "\n",
        clauseBoundary: clausePunctuation.has(value) || value === "\n",
        commitBoundary: value === "\n",
      });
    }
  };

  for (const island of islands) {
    appendFixed(text.slice(cursor, island.sourceStart), cursor);
    events.push({
      kind: "v7",
      sourceText: island.sourceText,
      targetText: island.sourceText,
      targetSyllables: [...island.targetSyllables],
      v7Code: island.v7Code,
    });
    cursor = island.sourceEnd;
  }
  appendFixed(text.slice(cursor), cursor);
  return events;
}

const appendFixedPart = (state: MutableSessionState, value: string): void => {
  const last = state.parts[state.parts.length - 1];
  if (last?.kind === "fixed") {
    last.value += value;
  } else {
    state.parts.push({ kind: "fixed", value });
  }
};

const appendV7Part = (
  state: MutableSessionState,
  event: Extract<PlannedSessionEvent, { kind: "v7" }>,
): void => {
  if (state.parts[state.parts.length - 1]?.kind !== "fixed") {
    state.parts.push({ kind: "fixed", value: "" });
  }
  state.parts.push({
    kind: "v7",
    value: event.v7Code,
    targetSyllables: [...event.targetSyllables],
  });
  state.parts.push({ kind: "fixed", value: "" });
};

const getRequest = (parts: readonly SessionPart[]): string[] =>
  parts.map((part) => part.value);

const unresolvedPreview = (parts: readonly SessionPart[]): string =>
  parts
    .map((part) => (part.kind === "fixed" ? part.value : `[${part.value}]`))
    .join("");

const previewText = (state: MutableSessionState): string =>
  state.candidates[0]?.text ?? unresolvedPreview(state.parts);

const collapseToFixed = (state: MutableSessionState, text: string): void => {
  state.parts = [{ kind: "fixed", value: text }];
  state.candidates = [];
};

const replacementSyllables = (replacement: string): string[] => {
  const normalized = replacement.normalize("NFC").trim();
  if (!normalized) return [];
  const parts = [
    ...new Intl.Segmenter("vi", { granularity: "word" }).segment(normalized),
  ];
  if (
    parts.some((part) => !part.isWordLike && part.segment.trim().length > 0)
  ) {
    return [];
  }
  return parts
    .filter((part) => part.isWordLike)
    .map((part) => normalizeText(part.segment));
};

const legalReplacement = (replacement: string, part: V7Part): boolean => {
  const syllables = replacementSyllables(replacement);
  if (syllables.length !== part.targetSyllables.length) return false;
  const codes = syllables.map((syllable) => getV7Code(syllable));
  return (
    codes.every((code) => code !== undefined) && codes.join("") === part.value
  );
};

const normalizeCandidate = (
  candidate: InferenceCandidate,
  parts: readonly SessionPart[],
): RenderedCandidate | null => {
  const request = getRequest(parts);
  const v7Parts = parts.filter((part): part is V7Part => part.kind === "v7");
  let replacements: string[];

  if (typeof candidate === "string") {
    if (v7Parts.length !== 1) return null;
    const v7Index = parts.findIndex((part) => part.kind === "v7");
    const prefix = request.slice(0, v7Index).join("");
    const suffix = request.slice(v7Index + 1).join("");
    if (
      !candidate.startsWith(prefix) ||
      !candidate.endsWith(suffix) ||
      candidate.length < prefix.length + suffix.length
    ) {
      return null;
    }
    replacements = [
      candidate.slice(
        prefix.length,
        suffix ? candidate.length - suffix.length : undefined,
      ),
    ];
  } else if (candidate.length === v7Parts.length) {
    replacements = [...candidate];
  } else if (candidate.length === request.length) {
    for (let index = 0; index < parts.length; index += 1) {
      if (
        parts[index]?.kind === "fixed" &&
        candidate[index] !== parts[index]?.value
      ) {
        return null;
      }
    }
    replacements = parts.flatMap((part, index) =>
      part.kind === "v7" ? [candidate[index] ?? ""] : [],
    );
  } else {
    return null;
  }

  if (
    replacements.length !== v7Parts.length ||
    replacements.some(
      (replacement, index) =>
        !legalReplacement(replacement, v7Parts[index] as V7Part),
    )
  ) {
    return null;
  }

  let replacementIndex = 0;
  const text = parts
    .map((part) =>
      part.kind === "fixed"
        ? part.value
        : (replacements[replacementIndex++] ?? ""),
    )
    .join("");
  return { replacements, text };
};

class InferenceTimeoutError extends Error {}

const invokeInference = async (
  inference: InferenceFunction,
  request: string[],
  timeoutMs: number | undefined,
): Promise<{ response: readonly InferenceCandidate[]; latencyMs: number }> => {
  const startedAt = performance.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const invocation = Promise.resolve().then(() => inference([...request]));
  let response: Awaited<ReturnType<InferenceFunction>>;
  try {
    response =
      timeoutMs === undefined
        ? await invocation
        : await Promise.race([
            invocation,
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () =>
                  reject(
                    new InferenceTimeoutError(
                      `Inference exceeded ${timeoutMs} ms.`,
                    ),
                  ),
                timeoutMs,
              );
            }),
          ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
  const latencyMs = performance.now() - startedAt;
  if (timeoutMs !== undefined && latencyMs > timeoutMs) {
    throw new InferenceTimeoutError(`Inference exceeded ${timeoutMs} ms.`);
  }
  if (!Array.isArray(response)) {
    throw new TypeError("Inference must return an array of candidates.");
  }
  return { response, latencyMs };
};

const runInference = async (
  state: MutableSessionState,
  inference: InferenceFunction,
  timeoutMs: number | undefined,
): Promise<SessionFailure | null> => {
  const request = getRequest(state.parts);
  state.candidates = [];
  let response: readonly InferenceCandidate[];
  let latencyMs: number;
  try {
    ({ response, latencyMs } = await invokeInference(
      inference,
      request,
      timeoutMs,
    ));
  } catch (error) {
    if (error instanceof InferenceTimeoutError) return TIMEOUT;
    // Isolated evaluators can enforce a hard process deadline outside this
    // thread and report it with this stable error code.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "TIME_LIMIT"
    ) {
      return TIMEOUT;
    }
    throw error;
  }
  state.latencies.push(latencyMs);
  const candidates = response.map((candidate) =>
    normalizeCandidate(candidate, state.parts),
  );
  if (candidates.some((candidate) => candidate === null)) return ILLEGAL;
  state.candidates = candidates as RenderedCandidate[];
  return null;
};

const finishCascade = (state: MutableSessionState): void => {
  if (state.activeCascadeLength > 0) {
    state.cascadeLengths.push(state.activeCascadeLength);
  }
  state.activeCascadeLength = 0;
  state.firstErrorAtV7Entry = null;
};

const observePrediction = (state: MutableSessionState): void => {
  if (sameText(previewText(state), state.targetText)) {
    finishCascade(state);
    return;
  }
  if (state.activeCascadeLength === 0) {
    state.firstErrorAtV7Entry = state.v7Entries;
  }
  state.activeCascadeLength += 1;
};

const mismatchPositions = (
  target: readonly string[],
  actual: readonly string[],
): number[] => {
  if (target.length !== actual.length) return [];
  return target.flatMap((token, index) =>
    token === actual[index] ? [] : [index],
  );
};

const planPiecemealRanges = (
  mismatches: readonly number[],
  weights: SessionActionWeights,
): Array<{ start: number; end: number }> => {
  if (mismatches.length === 0) return [];
  const memo = new Map<
    number,
    { cost: number; ranges: Array<[number, number]> }
  >();
  const solve = (
    mismatchIndex: number,
  ): { cost: number; ranges: Array<[number, number]> } => {
    if (mismatchIndex >= mismatches.length) return { cost: 0, ranges: [] };
    const cached = memo.get(mismatchIndex);
    if (cached) return cached;
    const start = mismatches[mismatchIndex] as number;
    let best = {
      cost: Number.POSITIVE_INFINITY,
      ranges: [] as Array<[number, number]>,
    };
    for (
      let finalMismatch = mismatchIndex;
      finalMismatch < mismatches.length;
      finalMismatch += 1
    ) {
      const end = (mismatches[finalMismatch] as number) + 1;
      const suffix = solve(finalMismatch + 1);
      const cost =
        weights.piecemealEntry +
        (end - start) * weights.piecemealReplacement +
        suffix.cost;
      if (cost < best.cost) {
        best = { cost, ranges: [[start, end], ...suffix.ranges] };
      }
    }
    memo.set(mismatchIndex, best);
    return best;
  };
  return solve(0).ranges.map(([start, end]) => ({ start, end }));
};

const contiguousRanges = (
  positions: readonly number[],
): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const position of positions) {
    const last = ranges[ranges.length - 1];
    if (last && last.end === position) {
      last.end += 1;
    } else {
      ranges.push({ start: position, end: position + 1 });
    }
  }
  return ranges;
};

const unequalTokenRange = (
  target: readonly string[],
  actual: readonly string[],
): { start: number; end: number; targetEnd: number } | null => {
  let start = 0;
  while (
    start < target.length &&
    start < actual.length &&
    target[start] === actual[start]
  ) {
    start += 1;
  }
  let targetEnd = target.length;
  let actualEnd = actual.length;
  while (
    targetEnd > start &&
    actualEnd > start &&
    target[targetEnd - 1] === actual[actualEnd - 1]
  ) {
    targetEnd -= 1;
    actualEnd -= 1;
  }
  return start === targetEnd && start === actualEnd
    ? null
    : { start, end: actualEnd, targetEnd };
};

const chargeExternalRecovery = (
  state: MutableSessionState,
  ranges: Array<{ start: number; end: number; targetEnd?: number }>,
  targetTokenCount: number,
  actualTokenCount: number,
): void => {
  if (ranges.length === 0) return;
  state.actions.commits += 1;
  let cursor = actualTokenCount;
  for (const range of [...ranges].sort(
    (left, right) => right.start - left.start,
  )) {
    state.actions.cursorMoves += Math.abs(cursor - range.end);
    const removed = Math.max(0, range.end - range.start);
    state.actions.selectionExtensions += removed;
    if (removed > 0) state.actions.deletions += 1;
    const targetEnd = range.targetEnd ?? range.end;
    const inserted = Math.max(0, targetEnd - range.start);
    state.actions.deterministicRetypes += inserted;
    cursor = range.start + inserted;
  }
  state.actions.cursorMoves += Math.abs(targetTokenCount - cursor);
};

const recover = (
  state: MutableSessionState,
  candidateLimit: number,
  weights: SessionActionWeights,
  combinedWithNextEntry: boolean,
): SessionRecovery | null => {
  const actualText = previewText(state);
  if (sameText(actualText, state.targetText)) return null;

  const exactCandidateIndex = state.candidates
    .slice(0, candidateLimit)
    .findIndex((candidate) => sameText(candidate.text, state.targetText));
  const detectionDelay =
    state.firstErrorAtV7Entry === null
      ? 0
      : state.v7Entries - state.firstErrorAtV7Entry;

  if (exactCandidateIndex > 0) {
    const selected = state.candidates[exactCandidateIndex] as RenderedCandidate;
    state.actions.candidateSelections += 1;
    if (combinedWithNextEntry) {
      state.actions.combinedCandidateSelections += 1;
    }
    state.actions.candidateInspectionSteps += exactCandidateIndex;
    state.selectedCandidateRanks.push(exactCandidateIndex + 1);
    state.recoveryDistances.push(detectionDelay);
    collapseToFixed(state, selected.text);
    finishCascade(state);
    return {
      strategy: "candidate-selection",
      combinedWithNextEntry,
      selectedCandidateRank: exactCandidateIndex + 1,
      piecemealRanges: [],
      externalRanges: [],
      detectionDelayV7Entries: detectionDelay,
    };
  }

  const targetTokens = wordTokens(state.targetText);
  const actualTokens = wordTokens(actualText);
  const allMismatches = mismatchPositions(targetTokens, actualTokens);
  let piecemealRanges: Array<{ start: number; end: number }> = [];
  let externalRanges: Array<{
    start: number;
    end: number;
    targetEnd?: number;
  }> = [];

  if (targetTokens.length === actualTokens.length) {
    const firstPiecemeal = Math.max(0, targetTokens.length - 9);
    const recent = allMismatches.filter((index) => index >= firstPiecemeal);
    const old = allMismatches.filter((index) => index < firstPiecemeal);
    piecemealRanges = planPiecemealRanges(recent, weights);
    externalRanges = contiguousRanges(old);
  } else {
    const range = unequalTokenRange(targetTokens, actualTokens);
    if (range) externalRanges = [range];
  }

  for (const range of piecemealRanges) {
    state.actions.piecemealEntries += 1;
    state.actions.piecemealReplacements += range.end - range.start;
  }
  chargeExternalRecovery(
    state,
    externalRanges,
    targetTokens.length,
    actualTokens.length,
  );
  state.recoveryDistances.push(detectionDelay);
  collapseToFixed(state, normalizeText(state.targetText));
  finishCascade(state);

  const strategy: RecoveryStrategy =
    piecemealRanges.length > 0 && externalRanges.length > 0
      ? "piecemeal-and-external-editor"
      : externalRanges.length > 0
        ? "external-editor"
        : "piecemeal";
  return {
    strategy,
    combinedWithNextEntry: false,
    selectedCandidateRank: null,
    piecemealRanges,
    externalRanges: externalRanges.map(({ start, end }) => ({ start, end })),
    detectionDelayV7Entries: detectionDelay,
  };
};

const shouldDetectAfterV7 = (
  policy: DetectionPolicy,
  state: MutableSessionState,
): boolean => {
  if (state.firstErrorAtV7Entry === null) return false;
  switch (policy.kind) {
    case "immediate":
      return true;
    case "after-v7":
      return (
        state.v7Entries - state.firstErrorAtV7Entry >=
        nonNegativeNumber(policy.delay, "policy.delay")
      );
    default:
      return false;
  }
};

const physicalActionCount = (actions: SessionActionCounts): number =>
  actions.v7Entries +
  actions.fixedEntries +
  actions.candidateSelections -
  actions.combinedCandidateSelections +
  actions.piecemealEntries +
  actions.piecemealReplacements +
  actions.commits +
  actions.cursorMoves +
  actions.selectionExtensions +
  actions.deletions +
  actions.deterministicRetypes;

const weightedActionCost = (
  actions: SessionActionCounts,
  weights: SessionActionWeights,
): number =>
  actions.v7Entries * weights.v7Entry +
  actions.fixedEntries * weights.fixedEntry +
  (actions.candidateSelections - actions.combinedCandidateSelections) *
    weights.candidateSelection +
  actions.candidateInspectionSteps * weights.candidateInspectionStep +
  actions.piecemealEntries * weights.piecemealEntry +
  actions.piecemealReplacements * weights.piecemealReplacement +
  actions.commits * weights.commit +
  actions.cursorMoves * weights.cursorMove +
  actions.selectionExtensions * weights.selectionExtension +
  actions.deletions * weights.deletion +
  actions.deterministicRetypes * weights.deterministicRetype;

const buildMetrics = (
  state: MutableSessionState,
  finalText: string,
  targetText: string,
  weights: SessionActionWeights,
  actionTimeMs: SessionActionWeights | undefined,
): SessionMetrics => {
  const targetTokens = wordTokens(targetText);
  const finalTokens = wordTokens(finalText);
  const errors = editDistance(targetTokens, finalTokens);
  const propagating = state.cascadeLengths.filter(
    (length) => length > 1,
  ).length;
  return {
    physicalActions: physicalActionCount(state.actions),
    interactionCost: weightedActionCost(state.actions, weights),
    ...(actionTimeMs
      ? { estimatedTimeMs: weightedActionCost(state.actions, actionTimeMs) }
      : {}),
    finalSyllableErrors: errors,
    finalSyllableErrorRate:
      targetTokens.length === 0 ? 0 : errors / targetTokens.length,
    finalTextExact: sameText(finalText, targetText),
    errorCascades: [...state.cascadeLengths],
    meanCascadeLength: mean(state.cascadeLengths),
    p95CascadeLength: percentile(state.cascadeLengths, 0.95),
    propagatingCascadeRate:
      state.cascadeLengths.length === 0
        ? 0
        : propagating / state.cascadeLengths.length,
    recoveryDistancesV7Entries: [...state.recoveryDistances],
    meanRecoveryDistanceV7Entries: mean(state.recoveryDistances),
    selectedCandidateRanks: [...state.selectedCandidateRanks],
    meanSelectedCandidateRank: mean(state.selectedCandidateRanks),
    inferenceCalls: state.latencies.length,
    inferenceLatencyP50Ms: percentile(state.latencies, 0.5),
    inferenceLatencyP95Ms: percentile(state.latencies, 0.95),
    inferenceLatencyMaxMs:
      state.latencies.length === 0 ? 0 : Math.max(...state.latencies),
  };
};

/**
 * Replay a complete composition through the IME's causal editing model.
 *
 * Unlike the local evaluator, unresolved V7 islands stay live, later
 * inference sees the actual current buffer, punctuation auto-accepts the
 * current preview, and recovery is constrained by the nine-syllable
 * piecemeal window before falling back to editor operations.
 */
export async function evaluateImeSession(
  text: string,
  inference: InferenceFunction,
  options: SessionEvaluationOptions = {},
): Promise<SessionEvaluationResult> {
  const policy = options.policy ?? { kind: "immediate" };
  if (
    policy.kind === "after-v7" &&
    (!Number.isInteger(policy.delay) || policy.delay < 0)
  ) {
    throw new RangeError("policy.delay must be a non-negative integer.");
  }
  const candidateLimit = positiveInteger(
    options.candidateLimit ?? 5,
    "candidateLimit",
  );
  const maxSyllables = positiveInteger(
    options.maxSyllablesPerV7Island ?? 2,
    "maxSyllablesPerV7Island",
  );
  const timeoutMs =
    options.inferenceTimeoutMs === undefined
      ? undefined
      : positiveInteger(options.inferenceTimeoutMs, "inferenceTimeoutMs");
  const weights = resolveWeights(options.weights);
  const actionTimeMs = options.actionTimeMs
    ? resolveWeights(options.actionTimeMs, "actionTimeMs", {
        v7Entry: 0,
        fixedEntry: 0,
        candidateSelection: 0,
        candidateInspectionStep: 0,
        piecemealEntry: 0,
        piecemealReplacement: 0,
        commit: 0,
        cursorMove: 0,
        selectionExtension: 0,
        deletion: 0,
        deterministicRetype: 0,
      })
    : undefined;
  const events = options.plan
    ? [...options.plan]
    : buildImeSessionPlan(text, maxSyllables);
  const state: MutableSessionState = {
    parts: [{ kind: "fixed", value: "" }],
    targetText: "",
    candidates: [],
    v7Entries: 0,
    firstErrorAtV7Entry: null,
    activeCascadeLength: 0,
    cascadeLengths: [],
    recoveryDistances: [],
    selectedCandidateRanks: [],
    actions: emptyActions(),
    latencies: [],
  };
  const trace: SessionTraceStep[] = [];
  let failure: SessionFailure | null = null;

  for (const [eventIndex, event] of events.entries()) {
    let recovery: SessionRecovery | null = null;
    let request: string[] | null = null;
    let latencyMs: number | null = null;

    if (
      event.kind === "fixed" &&
      event.clauseBoundary &&
      policy.kind === "clause"
    ) {
      recovery = recover(
        state,
        candidateLimit,
        weights,
        event.autoAcceptsPreview && !event.commitBoundary,
      );
    }

    if (event.kind === "fixed") {
      if (event.autoAcceptsPreview && state.candidates.length > 0) {
        collapseToFixed(state, state.candidates[0]?.text ?? previewText(state));
      }
      appendFixedPart(state, event.targetText);
      state.targetText += event.targetText;
      state.actions.fixedEntries += event.inputActions;
      if (
        event.inputActions > 0 &&
        state.parts.some((part) => part.kind === "v7")
      ) {
        request = getRequest(state.parts);
        const beforeCalls = state.latencies.length;
        failure = await runInference(state, inference, timeoutMs);
        latencyMs =
          state.latencies.length > beforeCalls
            ? (state.latencies[state.latencies.length - 1] ?? null)
            : null;
        if (!failure) observePrediction(state);
      }
    } else {
      appendV7Part(state, event);
      state.targetText += event.targetText;
      state.actions.v7Entries += 1;
      state.v7Entries += 1;
      request = getRequest(state.parts);
      const beforeCalls = state.latencies.length;
      failure = await runInference(state, inference, timeoutMs);
      latencyMs =
        state.latencies.length > beforeCalls
          ? (state.latencies[state.latencies.length - 1] ?? null)
          : null;
      if (!failure) {
        observePrediction(state);
        if (shouldDetectAfterV7(policy, state)) {
          recovery = recover(state, candidateLimit, weights, false);
        }
      }
    }

    trace.push({
      eventIndex,
      event,
      targetText: state.targetText,
      request,
      visibleCandidates: state.candidates
        .slice(0, candidateLimit)
        .map((candidate) => candidate.text),
      previewText: previewText(state),
      latencyMs,
      recovery,
      cumulativeActions: cloneActions(state.actions),
    });
    if (failure) break;
  }

  if (!failure && policy.kind !== "never") {
    const recovery = recover(state, candidateLimit, weights, false);
    if (recovery) {
      trace.push({
        eventIndex: events.length,
        event: { kind: "final-detection" },
        targetText: state.targetText,
        request: null,
        visibleCandidates: [],
        previewText: previewText(state),
        latencyMs: null,
        recovery,
        cumulativeActions: cloneActions(state.actions),
      });
    }
  }
  finishCascade(state);

  const finalText = previewText(state);
  return {
    failure,
    policy,
    targetText: text,
    finalText,
    representableSyllables: events.reduce(
      (total, event) =>
        total + (event.kind === "v7" ? event.targetSyllables.length : 0),
      0,
    ),
    actions: cloneActions(state.actions),
    metrics: buildMetrics(state, finalText, text, weights, actionTimeMs),
    trace,
  };
}

/** Run the same deterministic decoder under a predeclared sensitivity curve. */
export async function evaluateImeScenarios(
  text: string,
  inference: InferenceFunction,
  options: Omit<SessionEvaluationOptions, "policy"> & {
    policies?: readonly DetectionPolicy[];
  } = {},
): Promise<SessionScenarioResult[]> {
  const { policies = DEFAULT_DETECTION_POLICIES, ...sharedOptions } = options;
  const plan =
    sharedOptions.plan ??
    buildImeSessionPlan(text, sharedOptions.maxSyllablesPerV7Island ?? 2);
  const results: SessionScenarioResult[] = [];
  for (const policy of policies) {
    results.push({
      policy,
      result: await evaluateImeSession(text, inference, {
        ...sharedOptions,
        plan,
        policy,
      }),
    });
  }
  return results;
}
