import { getV7Code } from "../src/v7Core";

export type InferenceCandidate = string | readonly string[];
export type InferenceResponse = readonly InferenceCandidate[];
export type InferenceFunction = (
  request: string[],
) => InferenceResponse | Promise<InferenceResponse>;
export type TypedInferenceIsland =
  | { kind: "fixed"; text: string }
  | { kind: "v7"; code: string; mode: "compositional" | "dictionary" };
export type TypedInferenceFunction = (request: {
  version: 2;
  islands: TypedInferenceIsland[];
}) =>
  | InferenceResponse
  | { candidates: InferenceResponse; dictionaryBucketSizes?: readonly number[] }
  | Promise<
      | InferenceResponse
      | {
          candidates: InferenceResponse;
          dictionaryBucketSizes?: readonly number[];
        }
    >;

export interface DictionaryEvaluationStep {
  sourceText: string;
  v7Code: string;
  dictionaryBucketSize: number;
  dictionaryMiss: boolean;
  compositionalTop1: boolean;
  dictionaryTop1: boolean;
  dictionaryTop5: boolean;
}

export interface DictionaryEvaluationResult {
  coveredPairs: number;
  misses: number;
  top1: number;
  top5: number;
  steps: DictionaryEvaluationStep[];
}

export interface EvaluationWeights {
  /** Enter one V7 island (normally one chord containing up to two syllables). */
  v7Entry: number;
  /** Select any visible candidate other than the first candidate. */
  candidateSelection: number;
  /** Enter piecemeal-edit mode at a position. */
  piecemealEntry: number;
  /** Replace one syllable while in piecemeal-edit mode. */
  piecemealReplacement: number;
}

export interface EvaluationOptions {
  /** Only candidates in this visible prefix can be selected. Defaults to 5. */
  candidateLimit?: number;
  /** V7 encodes at most two adjacent syllables in one island by default. */
  maxSyllablesPerV7Island?: number;
  weights?: Partial<EvaluationWeights>;
}

export type CorrectionStrategy = "accept" | "candidate-selection" | "piecemeal";

export interface EvaluationStep {
  sourceText: string;
  targetSyllables: string[];
  v7Code: string;
  request: string[];
  topPrediction: string[];
  selectedCandidateIndex: number | null;
  strategy: CorrectionStrategy;
  v7EntryCost: number;
  correctionCost: number;
  score: number;
}

export interface EvaluationResult {
  /**
   * Total interaction cost, or ILLEGAL when inference emitted a candidate that
   * cannot be represented by the requested V7 island.
   */
  score: EvaluationScore;
  representableSyllables: number;
  fixedText: string[];
  steps: EvaluationStep[];
}

/** Returned instead of a numeric score when an inference candidate violates V7. */
export const ILLEGAL = "ILLEGAL" as const;
export type EvaluationScore = number | typeof ILLEGAL;

export interface EvaluationIsland {
  sourceStart: number;
  sourceEnd: number;
  sourceText: string;
  targetSyllables: string[];
  v7Code: string;
}

const DEFAULT_WEIGHTS: EvaluationWeights = {
  v7Entry: 1,
  candidateSelection: 1,
  piecemealEntry: 1,
  piecemealReplacement: 1,
};

const normalizeSyllable = (value: string): string =>
  value.normalize("NFC").toLocaleLowerCase("vi");

const sameSyllables = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const isV7IslandSeparator = (value: string): boolean => value === " ";

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
  partial: Partial<EvaluationWeights> | undefined,
): EvaluationWeights => {
  const weights = { ...DEFAULT_WEIGHTS, ...partial };
  return {
    v7Entry: nonNegativeNumber(weights.v7Entry, "weights.v7Entry"),
    candidateSelection: nonNegativeNumber(
      weights.candidateSelection,
      "weights.candidateSelection",
    ),
    piecemealEntry: nonNegativeNumber(
      weights.piecemealEntry,
      "weights.piecemealEntry",
    ),
    piecemealReplacement: nonNegativeNumber(
      weights.piecemealReplacement,
      "weights.piecemealReplacement",
    ),
  };
};

/**
 * Split the target into V7 islands. Words that cannot be represented by the V7
 * tokenizer, along with punctuation and layout, remain fixed text.
 */
export function buildEvaluationIslands(
  text: string,
  maxSyllablesPerV7Island = 2,
): EvaluationIsland[] {
  positiveInteger(maxSyllablesPerV7Island, "maxSyllablesPerV7Island");

  const parts = [
    ...new Intl.Segmenter("vi", { granularity: "word" }).segment(text),
  ];
  const islands: EvaluationIsland[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part.isWordLike) continue;

    const normalized = normalizeSyllable(part.segment);
    const firstCode = getV7Code(normalized);
    if (!firstCode) continue;

    const targetSyllables = [normalized];
    const codes = [firstCode];
    let lastPartIndex = index;

    while (targetSyllables.length < maxSyllablesPerV7Island) {
      let nextWordIndex = lastPartIndex + 1;
      let separator = "";
      while (nextWordIndex < parts.length && !parts[nextWordIndex].isWordLike) {
        separator += parts[nextWordIndex].segment;
        nextWordIndex += 1;
      }

      if (nextWordIndex >= parts.length || !isV7IslandSeparator(separator)) {
        break;
      }

      const nextSyllable = normalizeSyllable(parts[nextWordIndex].segment);
      const nextCode = getV7Code(nextSyllable);
      if (!nextCode) break;

      targetSyllables.push(nextSyllable);
      codes.push(nextCode);
      lastPartIndex = nextWordIndex;
    }

    const sourceStart = part.index;
    const lastPart = parts[lastPartIndex];
    const sourceEnd = lastPart.index + lastPart.segment.length;
    islands.push({
      sourceStart,
      sourceEnd,
      sourceText: text.slice(sourceStart, sourceEnd),
      targetSyllables,
      v7Code: codes.join(""),
    });
    index = lastPartIndex;
  }

  return islands;
}

const getFixedText = (
  text: string,
  islands: readonly EvaluationIsland[],
): string[] => {
  const fixed: string[] = [];
  let cursor = 0;
  for (const island of islands) {
    const span = text.slice(cursor, island.sourceStart);
    if (span) fixed.push(span);
    cursor = island.sourceEnd;
  }
  const trailing = text.slice(cursor);
  if (trailing) fixed.push(trailing);
  return fixed;
};

const candidateReplacement = (
  candidate: InferenceCandidate,
  request: readonly string[],
): string | null => {
  if (typeof candidate === "string") {
    const prefix = request[0];
    const suffix = request[2];
    if (
      candidate.startsWith(prefix) &&
      candidate.endsWith(suffix) &&
      candidate.length >= prefix.length + suffix.length
    ) {
      return candidate.slice(
        prefix.length,
        suffix ? candidate.length - suffix.length : undefined,
      );
    }
    return candidate;
  }

  if (candidate.length === 1) return candidate[0];
  if (candidate.length === request.length) return candidate[1];
  return null;
};

const getSyllables = (text: string | null): string[] => {
  if (text === null) return [];
  return [...new Intl.Segmenter("vi", { granularity: "word" }).segment(text)]
    .filter((part) => part.isWordLike)
    .map((part) => normalizeSyllable(part.segment));
};

/**
 * A V7 replacement may contain only word-like Vietnamese syllables separated
 * by whitespace. Every syllable must have a V7 code, and their concatenation
 * must exactly reproduce the requested island.
 */
const isLegalV7Replacement = (
  replacement: string | null,
  v7Code: string,
): boolean => {
  if (replacement === null) return false;

  const normalized = replacement.normalize("NFC").trim();
  if (!normalized) return false;

  const parts = [
    ...new Intl.Segmenter("vi", { granularity: "word" }).segment(normalized),
  ];
  if (
    parts.some((part) => !part.isWordLike && part.segment.trim().length > 0)
  ) {
    return false;
  }

  const syllables = getSyllables(normalized);
  if (syllables.length === 0) return false;

  const codes = syllables.map((syllable) => getV7Code(syllable));
  return codes.every((code) => code !== undefined) && codes.join("") === v7Code;
};

/**
 * Find the cheapest sequence of piecemeal edits. A piecemeal entry may replace
 * a contiguous range because the edit cursor advances after every replacement.
 * Retyping a correct syllable can therefore be cheaper than entering edit mode
 * a second time.
 */
export function getPiecemealCorrectionCost(
  target: readonly string[],
  prediction: readonly string[],
  weights: Pick<
    EvaluationWeights,
    "piecemealEntry" | "piecemealReplacement"
  > = DEFAULT_WEIGHTS,
): number {
  if (sameSyllables(target, prediction)) return 0;
  if (target.length === 0) return 0;

  if (target.length !== prediction.length) {
    return (
      weights.piecemealEntry + target.length * weights.piecemealReplacement
    );
  }

  const memo = new Map<number, number>();
  const solve = (from: number): number => {
    let firstMismatch = from;
    while (
      firstMismatch < target.length &&
      target[firstMismatch] === prediction[firstMismatch]
    ) {
      firstMismatch += 1;
    }
    if (firstMismatch === target.length) return 0;

    const cached = memo.get(firstMismatch);
    if (cached !== undefined) return cached;

    let best = Number.POSITIVE_INFINITY;
    for (let end = firstMismatch; end < target.length; end += 1) {
      const rangeCost =
        weights.piecemealEntry +
        (end - firstMismatch + 1) * weights.piecemealReplacement;
      best = Math.min(best, rangeCost + solve(end + 1));
    }
    memo.set(firstMismatch, best);
    return best;
  };

  return solve(0);
}

/**
 * Return an explainable inconvenience score. Fixed text is supplied verbatim
 * and costs zero; every representable island pays for its V7 entry and then
 * takes the cheapest available correction route.
 */
export async function evaluateDetailed(
  text: string,
  inference: InferenceFunction,
  options: EvaluationOptions = {},
): Promise<EvaluationResult> {
  const candidateLimit = positiveInteger(
    options.candidateLimit ?? 5,
    "candidateLimit",
  );
  const maxSyllables = positiveInteger(
    options.maxSyllablesPerV7Island ?? 2,
    "maxSyllablesPerV7Island",
  );
  const weights = resolveWeights(options.weights);
  const islands = buildEvaluationIslands(text, maxSyllables);
  const steps: EvaluationStep[] = [];

  for (const island of islands) {
    const request = [text.slice(0, island.sourceStart), island.v7Code, ""];
    const response = await inference([...request]);
    if (!Array.isArray(response)) {
      throw new TypeError("Inference must return an array of candidates.");
    }

    const replacements = response.map((candidate) =>
      candidateReplacement(candidate, request),
    );
    if (
      replacements.some(
        (replacement) => !isLegalV7Replacement(replacement, island.v7Code),
      )
    ) {
      return {
        score: ILLEGAL,
        representableSyllables: islands.reduce(
          (total, currentIsland) =>
            total + currentIsland.targetSyllables.length,
          0,
        ),
        fixedText: getFixedText(text, islands),
        steps,
      };
    }

    const predictions = replacements
      .slice(0, candidateLimit)
      .map((replacement) => getSyllables(replacement));
    const topPrediction = predictions[0] ?? [];
    const exactCandidateIndex = predictions.findIndex((candidate) =>
      sameSyllables(candidate, island.targetSyllables),
    );
    const piecemealCost = getPiecemealCorrectionCost(
      island.targetSyllables,
      topPrediction,
      weights,
    );

    let strategy: CorrectionStrategy;
    let correctionCost: number;
    let selectedCandidateIndex: number | null;

    if (exactCandidateIndex === 0) {
      strategy = "accept";
      correctionCost = 0;
      selectedCandidateIndex = 0;
    } else if (
      exactCandidateIndex > 0 &&
      weights.candidateSelection <= piecemealCost
    ) {
      strategy = "candidate-selection";
      correctionCost = weights.candidateSelection;
      selectedCandidateIndex = exactCandidateIndex;
    } else {
      strategy = "piecemeal";
      correctionCost = piecemealCost;
      selectedCandidateIndex = null;
    }

    steps.push({
      sourceText: island.sourceText,
      targetSyllables: [...island.targetSyllables],
      v7Code: island.v7Code,
      request,
      topPrediction,
      selectedCandidateIndex,
      strategy,
      v7EntryCost: weights.v7Entry,
      correctionCost,
      score: weights.v7Entry + correctionCost,
    });
  }

  return {
    score: steps.reduce((total, step) => total + step.score, 0),
    representableSyllables: islands.reduce(
      (total, island) => total + island.targetSyllables.length,
      0,
    ),
    fixedText: getFixedText(text, islands),
    steps,
  };
}

/** Compare lexical and compositional inference for each representable pair. */
export async function evaluateDictionaryMode(
  text: string,
  inference: TypedInferenceFunction,
): Promise<DictionaryEvaluationResult> {
  const pairIslands = buildEvaluationIslands(text, 2).filter(
    (island) => island.targetSyllables.length === 2,
  );
  const steps: DictionaryEvaluationStep[] = [];
  for (const island of pairIslands) {
    const request = (mode: "compositional" | "dictionary") => ({
      version: 2 as const,
      islands: [
        { kind: "fixed" as const, text: text.slice(0, island.sourceStart) },
        { kind: "v7" as const, code: island.v7Code, mode },
        { kind: "fixed" as const, text: "" },
      ],
    });
    const [compositionalResponse, dictionaryResponse] = await Promise.all([
      inference(request("compositional")),
      inference(request("dictionary")),
    ]);
    const responseCandidates = (
      response:
        | InferenceResponse
        | {
            candidates: InferenceResponse;
            dictionaryBucketSizes?: readonly number[];
          },
    ): InferenceResponse =>
      "candidates" in response ? response.candidates : response;
    const legacyRequest = [
      text.slice(0, island.sourceStart),
      island.v7Code,
      "",
    ];
    const normalizedCandidates = (response: InferenceResponse) =>
      response.map((candidate) =>
        getSyllables(candidateReplacement(candidate, legacyRequest)),
      );
    const compositional = responseCandidates(compositionalResponse);
    const dictionary = responseCandidates(dictionaryResponse);
    const compositionalCandidates = normalizedCandidates(compositional);
    const dictionaryCandidates = normalizedCandidates(dictionary);
    const exact = (candidate: readonly string[] | undefined) =>
      candidate !== undefined &&
      sameSyllables(candidate, island.targetSyllables);
    steps.push({
      sourceText: island.sourceText,
      v7Code: island.v7Code,
      dictionaryBucketSize:
        "dictionaryBucketSizes" in dictionaryResponse
          ? (dictionaryResponse.dictionaryBucketSizes?.[0] ??
            dictionaryCandidates.length)
          : dictionaryCandidates.length,
      dictionaryMiss: dictionaryCandidates.length === 0,
      compositionalTop1: exact(compositionalCandidates[0]),
      dictionaryTop1: exact(dictionaryCandidates[0]),
      dictionaryTop5: dictionaryCandidates.slice(0, 5).some(exact),
    });
  }
  return {
    coveredPairs: steps.filter((step) => !step.dictionaryMiss).length,
    misses: steps.filter((step) => step.dictionaryMiss).length,
    top1: steps.filter((step) => step.dictionaryTop1).length,
    top5: steps.filter((step) => step.dictionaryTop5).length,
    steps,
  };
}

export const evaluate = async (
  text: string,
  inference: InferenceFunction,
  options?: EvaluationOptions,
): Promise<EvaluationScore> =>
  (await evaluateDetailed(text, inference, options)).score;

export default evaluate;
