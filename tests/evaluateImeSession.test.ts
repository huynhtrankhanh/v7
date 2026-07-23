import {
  buildImeSessionPlan,
  evaluateImeScenarios,
  evaluateImeSession,
  TIMEOUT,
  type PlannedSessionEvent,
} from "../evaluator/evaluateImeSession";
import {
  ILLEGAL,
  type InferenceFunction,
} from "../evaluator/evaluateInference";

const v7Events = (
  text: string,
): Array<Extract<PlannedSessionEvent, { kind: "v7" }>> =>
  buildImeSessionPlan(text).filter(
    (event): event is Extract<PlannedSessionEvent, { kind: "v7" }> =>
      event.kind === "v7",
  );

const targetByCode = (text: string): Map<string, string> =>
  new Map(
    v7Events(text).map((event) => [
      event.v7Code,
      event.targetSyllables.join(" "),
    ]),
  );

const targetCandidates = (
  request: string[],
  targets: ReadonlyMap<string, string>,
): string[] =>
  request
    .filter((_, index) => index % 2 === 1)
    .map((code) => targets.get(code) ?? "");

describe("realistic IME session evaluator", () => {
  test("plans predictive islands and charges only non-automatic fixed input", () => {
    expect(buildImeSessionPlan("Trời mưa!")).toEqual([
      expect.objectContaining({
        kind: "v7",
        targetSyllables: ["trời", "mưa"],
        v7Code: "tro2mu0",
      }),
      expect.objectContaining({
        kind: "fixed",
        sourceText: "!",
        inputActions: 1,
        autoAcceptsPreview: true,
        clauseBoundary: true,
      }),
    ]);

    const spaces = buildImeSessionPlan("trời  mưa").filter(
      (event) => event.kind === "fixed",
    );
    expect(spaces).toEqual([
      expect.objectContaining({ sourceText: " ", inputActions: 1 }),
      expect.objectContaining({ sourceText: " ", inputActions: 1 }),
    ]);
  });

  test("keeps unresolved islands live and sends the whole composition", async () => {
    const text = "trời mưa nắng";
    const targets = targetByCode(text);
    const requests: string[][] = [];
    const inference: InferenceFunction = async (request) => {
      requests.push(request);
      const target = targetCandidates(request, targets);
      target[0] = "trời mua";
      return [target];
    };

    const result = await evaluateImeSession(text, inference, {
      policy: { kind: "never" },
    });

    expect(requests).toEqual([
      ["", "tro2mu0", ""],
      ["", "tro2mu0", " ", "na1", ""],
    ]);
    expect(result.finalText).toBe("trời mua nắng");
    expect(result.metrics.finalSyllableErrors).toBe(1);
  });

  test("selects an exact visible candidate and records its scan rank", async () => {
    const result = await evaluateImeSession(
      "trời mưa",
      async () => [["trời mua"], ["trời mưa"]],
      { policy: { kind: "immediate" } },
    );

    expect(result.failure).toBeNull();
    expect(result.finalText).toBe("trời mưa");
    expect(result.actions).toMatchObject({
      v7Entries: 1,
      candidateSelections: 1,
      combinedCandidateSelections: 0,
      candidateInspectionSteps: 1,
    });
    expect(result.metrics).toMatchObject({
      physicalActions: 2,
      selectedCandidateRanks: [2],
      finalTextExact: true,
    });
  });

  test("accepts the production alternating candidate shape", async () => {
    const result = await evaluateImeSession(
      "hello trời mưa",
      async () => [
        ["hello ", "trời mua", ""],
        ["hello ", "trời mưa", ""],
      ],
      { policy: { kind: "immediate" } },
    );

    expect(result.failure).toBeNull();
    expect(result.finalText).toBe("hello trời mưa");
    expect(result.metrics.selectedCandidateRanks).toEqual([2]);
  });

  test("combines clause-time candidate selection with punctuation", async () => {
    const result = await evaluateImeSession(
      "trời mưa.",
      async () => [["trời mua"], ["trời mưa"]],
      { policy: { kind: "clause" } },
    );

    expect(result.finalText).toBe("trời mưa.");
    expect(result.actions).toMatchObject({
      v7Entries: 1,
      fixedEntries: 1,
      candidateSelections: 1,
      combinedCandidateSelections: 1,
    });
    expect(result.metrics.physicalActions).toBe(2);
    expect(result.trace.find((step) => step.recovery)?.recovery).toMatchObject({
      strategy: "candidate-selection",
      combinedWithNextEntry: true,
      selectedCandidateRank: 2,
    });
  });

  test("allows later evidence to repair a preview without user correction", async () => {
    const text = "trời mưa nắng";
    const targets = targetByCode(text);
    const inference: InferenceFunction = async (request) => {
      const target = targetCandidates(request, targets);
      return request.length === 3 ? [["trời mua"]] : [target];
    };

    const result = await evaluateImeSession(text, inference, {
      policy: { kind: "never" },
    });

    expect(result.finalText).toBe("trời mưa nắng");
    expect(result.actions.candidateSelections).toBe(0);
    expect(result.metrics.errorCascades).toEqual([1]);
  });

  test("feeds punctuation-committed errors into later inference", async () => {
    const text = "trời mưa. nắng lên";
    const targets = targetByCode(text);
    const requests: string[][] = [];
    const inference: InferenceFunction = async (request) => {
      requests.push(request);
      const target = targetCandidates(request, targets);
      if (request.includes("tro2mu0")) target[0] = "trời mua";
      return [target];
    };

    await evaluateImeSession(text, inference, {
      policy: { kind: "never" },
    });

    expect(requests.at(-1)?.[0]).toBe("trời mua. ");
  });

  test("uses the real piecemeal entry-plus-replacement path", async () => {
    const result = await evaluateImeSession(
      "trời mưa",
      async () => [["trời mua"]],
      { policy: { kind: "immediate" } },
    );

    expect(result.finalText).toBe("trời mưa");
    expect(result.actions).toMatchObject({
      piecemealEntries: 1,
      piecemealReplacements: 1,
      commits: 0,
    });
    expect(result.metrics.physicalActions).toBe(3);
    expect(result.trace[0]?.recovery?.strategy).toBe("piecemeal");
  });

  test("falls back to committed editor recovery beyond the nine-syllable window", async () => {
    const text = "trời mưa nắng lên cao trong một ngày thật đẹp";
    const targets = targetByCode(text);
    const firstCode = v7Events(text)[0]?.v7Code;
    const inference: InferenceFunction = async (request) => {
      const target = targetCandidates(request, targets);
      const firstIndex = request.findIndex((part) => part === firstCode);
      if (firstIndex >= 0) {
        target[Math.floor(firstIndex / 2)] = "trò mưa";
      }
      return [target];
    };

    const result = await evaluateImeSession(text, inference, {
      policy: { kind: "end" },
    });

    expect(result.finalText).toBe(text);
    expect(result.actions).toMatchObject({
      commits: 1,
      selectionExtensions: 1,
      deletions: 1,
      deterministicRetypes: 1,
    });
    expect(result.actions.cursorMoves).toBeGreaterThan(0);
    expect(result.trace.at(-1)?.recovery?.strategy).toBe("external-editor");
  });

  test("treats changed fixed context as illegal output", async () => {
    const result = await evaluateImeSession(
      "hello trời mưa",
      async () => [["changed ", "trời mưa", ""]],
      { policy: { kind: "never" } },
    );

    expect(result.failure).toBe(ILLEGAL);
  });

  test("reports decoder deadlines as a hard failure", async () => {
    const result = await evaluateImeSession(
      "trời mưa",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [["trời mưa"]];
      },
      { inferenceTimeoutMs: 5 },
    );

    expect(result.failure).toBe(TIMEOUT);
  });

  test("runs a predeclared behavior sensitivity curve", async () => {
    const scenarios = await evaluateImeScenarios(
      "trời mưa",
      async () => [["trời mua"], ["trời mưa"]],
      {
        policies: [{ kind: "never" }, { kind: "immediate" }, { kind: "end" }],
      },
    );

    expect(scenarios.map(({ policy }) => policy.kind)).toEqual([
      "never",
      "immediate",
      "end",
    ]);
    expect(
      scenarios.map(({ result }) => result.metrics.finalSyllableErrors),
    ).toEqual([1, 0, 0]);
  });
});
