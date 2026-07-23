import {
  buildSynthesisObjective,
  compareSynthesisObjectives,
  evaluateSynthesisMeasure,
  prepareSynthesisCorpus,
} from "../evaluator/synthesisObjective";
import {
  evaluateImeScenarios,
  type SessionScenarioResult,
} from "../evaluator/evaluateImeSession";

const scenariosFor = async (
  inference: Parameters<typeof evaluateImeScenarios>[1],
): Promise<SessionScenarioResult[]> =>
  evaluateImeScenarios("trời mưa", inference, {
    policies: [{ kind: "never" }, { kind: "immediate" }, { kind: "end" }],
  });

describe("program-synthesis objective", () => {
  test("prioritizes free-running correctness before correction effort", async () => {
    const correct = buildSynthesisObjective(
      await scenariosFor(async () => [["trời mưa"]]),
    );
    const visibleCorrection = buildSynthesisObjective(
      await scenariosFor(async () => [["trời mua"], ["trời mưa"]]),
    );

    expect(compareSynthesisObjectives(correct, visibleCorrection)).toBe(-1);
    expect(correct[4]).toBe(0);
    expect(visibleCorrection[4]).toBe(1);
  });

  test("uses correcting-policy effort when free-running error ties", async () => {
    const candidateSelection = buildSynthesisObjective(
      await scenariosFor(async () => [["trời mua"], ["trời mưa"]]),
    );
    const piecemeal = buildSynthesisObjective(
      await scenariosFor(async () => [["trời mua"]]),
    );

    expect(candidateSelection[4]).toBe(piecemeal[4]);
    expect(compareSynthesisObjectives(candidateSelection, piecemeal)).toBe(-1);
  });

  test("makes hard failure dominate all later components", async () => {
    const feasible = buildSynthesisObjective(
      await scenariosFor(async () => [["trời mua"]]),
      { artifactBytes: 50_000 },
    );
    const illegal = buildSynthesisObjective(
      await scenariosFor(async () => [["trời bạn"]]),
      { artifactBytes: 1 },
    );

    expect(feasible[0]).toBe(0);
    expect(illegal[0]).toBe(1);
    expect(compareSynthesisObjectives(feasible, illegal)).toBe(-1);
  });

  test("uses artifact size only after behavior and latency tie", async () => {
    const scenarios = await scenariosFor(async () => [["trời mưa"]]);
    const small = buildSynthesisObjective(scenarios, { artifactBytes: 10_000 });
    const large = buildSynthesisObjective(scenarios, { artifactBytes: 20_000 });

    expect(compareSynthesisObjectives(small, large)).toBe(-1);
    expect(small.slice(0, -1)).toEqual(large.slice(0, -1));
  });

  test("exposes one corpus-to-objective evaluation function", async () => {
    const corpus = prepareSynthesisCorpus(["trời mưa", "trời mưa"]);
    const objective = await evaluateSynthesisMeasure(
      corpus,
      async () => [["trời mưa"]],
      {
        policies: [{ kind: "never" }, { kind: "immediate" }],
        artifactBytes: 12_345,
      },
    );

    expect(objective).toHaveLength(11);
    expect(objective[0]).toBe(0);
    expect(objective[4]).toBe(0);
    expect(objective[10]).toBe(12_345);
  });
});
