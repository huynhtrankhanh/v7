import { evaluateCorpus } from "../evaluation-server/src/evaluationService";
import {
  DEFAULT_INFERENCE_TIMEOUT_MS,
  type InferenceSession,
} from "../evaluation-server/src/dockerSandbox";

test("allows realistic model startup and large-corpus inference latency", () => {
  expect(DEFAULT_INFERENCE_TIMEOUT_MS).toBe(30_000);
});

test("returns causal metrics without the artifact-size field", async () => {
  const session: InferenceSession = {
    infer: jest.fn(async () => [["trời mưa"]]),
    close: jest.fn(async () => undefined),
  };
  const metrics = await evaluateCorpus(["trời mưa"], session);

  expect(metrics).toEqual({
    hardFailureFlag: 0,
    failedScenarioRuns: 0,
    illegalScenarioRuns: 0,
    timeoutScenarioRuns: 0,
    freeRunningFinalSyllableErrors: 0,
    worstCorrectingPolicyPhysicalActions: 1,
    totalCorrectingPhysicalActions: 6,
    p95ErrorCascadeLength: 0,
    totalCandidateInspectionSteps: 0,
    p95InferenceLatencyMilliseconds: expect.any(Number),
    dictionaryCoveredPairs: 1,
    dictionaryMisses: 0,
    dictionaryTop1: 1,
    dictionaryTop5: 1,
  });
  expect(metrics).not.toHaveProperty("artifactBytes");
  expect(session.infer).toHaveBeenCalledTimes(9);
});
