import {
  buildEvaluationIslands,
  evaluate,
  evaluateDetailed,
  getPiecemealCorrectionCost,
  ILLEGAL,
  type InferenceFunction,
} from "../evaluator/evaluateInference";

describe("inference inconvenience evaluator", () => {
  test("packs two adjacent V7 syllables into one island", () => {
    expect(buildEvaluationIslands("Trời mưa!")).toEqual([
      expect.objectContaining({
        sourceText: "Trời mưa",
        targetSyllables: ["trời", "mưa"],
        v7Code: "tro2mu0",
      }),
    ]);
  });

  test("preserves nonstandard spacing as fixed text between islands", async () => {
    const result = await evaluateDetailed("trời  mưa", async (request) => [
      [request[1] === "tro2" ? "trời" : "mưa"],
    ]);

    expect(result.score).toBe(2);
    expect(result.fixedText).toEqual(["  "]);
    expect(result.steps.map((step) => step.sourceText)).toEqual([
      "trời",
      "mưa",
    ]);
  });

  test("charges one V7 entry for a perfect prediction", async () => {
    const result = await evaluateDetailed("trời mưa", async () => [
      ["trời mưa"],
    ]);

    expect(result.score).toBe(1);
    expect(result.representableSyllables).toBe(2);
    expect(result.steps[0]).toMatchObject({
      strategy: "accept",
      correctionCost: 0,
      selectedCandidateIndex: 0,
    });
  });

  test("selects an exact visible candidate when it is cheapest", async () => {
    const result = await evaluateDetailed("trời mưa", async () => [
      ["trời mua"],
      ["trời mưa"],
    ]);

    expect(result.score).toBe(2);
    expect(result.steps[0]).toMatchObject({
      strategy: "candidate-selection",
      correctionCost: 1,
      selectedCandidateIndex: 1,
    });
  });

  test("uses piecemeal edit when no visible candidate is exact", async () => {
    const result = await evaluateDetailed("trời mưa", async () => [
      ["trời mua"],
    ]);

    expect(result.score).toBe(3);
    expect(result.steps[0]).toMatchObject({
      strategy: "piecemeal",
      correctionCost: 2,
      selectedCandidateIndex: null,
    });
  });

  test("optimizes contiguous piecemeal edit ranges", () => {
    expect(
      getPiecemealCorrectionCost(["một", "hai", "ba"], ["mốt", "hai", "bá"]),
    ).toBe(4);
    expect(
      getPiecemealCorrectionCost(["một", "hai", "ba"], ["mốt", "hai", "bá"], {
        piecemealEntry: 1,
        piecemealReplacement: 3,
      }),
    ).toBe(8);
  });

  test("keeps unrepresentable text fixed and free", async () => {
    const inference = jest.fn<ReturnType<InferenceFunction>, []>();
    const result = await evaluateDetailed("hello 👋!", inference);

    expect(result).toMatchObject({
      score: 0,
      representableSyllables: 0,
      fixedText: ["hello 👋!"],
      steps: [],
    });
    expect(inference).not.toHaveBeenCalled();
  });

  test("includes prior fixed and corrected text as inference context", async () => {
    const requests: string[][] = [];
    const score = await evaluate("hello trời mưa", async (request) => {
      requests.push(request);
      return ["hello trời mưa"];
    });

    expect(score).toBe(1);
    expect(requests).toEqual([["hello ", "tro2mu0", ""]]);
  });

  test("honors the visible candidate limit", async () => {
    const result = await evaluateDetailed(
      "trời mưa",
      async () => [["trời mua"], ["trời mua"], ["trời mưa"]],
      { candidateLimit: 2 },
    );

    expect(result.score).toBe(3);
    expect(result.steps[0].strategy).toBe("piecemeal");
  });

  test("returns ILLEGAL when any inference candidate does not round-trip to V7", async () => {
    const result = await evaluateDetailed("trời mưa", async () => [
      ["trời mua"],
      ["trời bạn"],
    ]);

    expect(result.score).toBe(ILLEGAL);
    expect(result.steps).toEqual([]);
    await expect(
      evaluate("trời mưa", async () => [["trời, mưa"]]),
    ).resolves.toBe(ILLEGAL);
  });
});
