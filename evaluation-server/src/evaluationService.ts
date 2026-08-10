import { evaluateSynthesisMeasure } from "../../evaluator/synthesisObjective";
import { evaluateDictionaryMode } from "../../evaluator/evaluateInference";
import type {
  InferenceFunction,
  InferenceResponse,
} from "../../evaluator/evaluateInference";
import type { InferenceSession } from "./dockerSandbox";

/** The causal synthesis objective, excluding its final artifact-size field. */
export interface CausalMetrics {
  hardFailureFlag: number;
  failedScenarioRuns: number;
  illegalScenarioRuns: number;
  timeoutScenarioRuns: number;
  freeRunningFinalSyllableErrors: number;
  worstCorrectingPolicyPhysicalActions: number;
  totalCorrectingPhysicalActions: number;
  p95ErrorCascadeLength: number;
  totalCandidateInspectionSteps: number;
  p95InferenceLatencyMilliseconds: number;
  dictionaryCoveredPairs: number;
  dictionaryMisses: number;
  dictionaryTop1: number;
  dictionaryTop5: number;
}

export async function evaluateCorpus(
  corpus: readonly string[],
  session: InferenceSession,
): Promise<CausalMetrics> {
  const inference: InferenceFunction = async (request) => {
    const result = await session.infer(request);
    if (!Array.isArray(result)) {
      throw new TypeError("Inference must return a JSON array.");
    }
    return result as InferenceResponse;
  };
  const objective = await evaluateSynthesisMeasure(corpus, inference, {
    artifactBytes: 0,
  });
  let dictionaryCoveredPairs = 0;
  let dictionaryMisses = 0;
  let dictionaryTop1 = 0;
  let dictionaryTop5 = 0;
  for (const text of corpus) {
    const dictionary = await evaluateDictionaryMode(text, async (request) => {
      const result = await session.infer(request);
      if (
        !Array.isArray(result) &&
        !(result && typeof result === "object" && "candidates" in result)
      ) {
        throw new TypeError("Typed inference must return candidates.");
      }
      return result as
        | InferenceResponse
        | {
            candidates: InferenceResponse;
            dictionaryBucketSizes?: readonly number[];
          };
    });
    dictionaryCoveredPairs += dictionary.coveredPairs;
    dictionaryMisses += dictionary.misses;
    dictionaryTop1 += dictionary.top1;
    dictionaryTop5 += dictionary.top5;
  }

  // objective[10] is artifactBytes and is intentionally not returned or logged.
  return {
    hardFailureFlag: objective[0],
    failedScenarioRuns: objective[1],
    illegalScenarioRuns: objective[2],
    timeoutScenarioRuns: objective[3],
    freeRunningFinalSyllableErrors: objective[4],
    worstCorrectingPolicyPhysicalActions: objective[5],
    totalCorrectingPhysicalActions: objective[6],
    p95ErrorCascadeLength: objective[7],
    totalCandidateInspectionSteps: objective[8],
    p95InferenceLatencyMilliseconds: objective[9],
    dictionaryCoveredPairs,
    dictionaryMisses,
    dictionaryTop1,
    dictionaryTop5,
  };
}
