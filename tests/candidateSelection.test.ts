import { getCandidateSelectionMatch } from "../src/candidateSelection";

describe("getCandidateSelectionMatch", () => {
  test("matches lone candidate selection strokes", () => {
    expect(getCandidateSelectionMatch("-T")).toEqual({ candidateIndex: 0, syllableStroke: null });
    expect(getCandidateSelectionMatch("-TS")).toEqual({ candidateIndex: 1, syllableStroke: null });
    expect(getCandidateSelectionMatch("-S")).toEqual({ candidateIndex: 2, syllableStroke: null });
    expect(getCandidateSelectionMatch("-D")).toEqual({ candidateIndex: 3, syllableStroke: null });
    expect(getCandidateSelectionMatch("-Z")).toEqual({ candidateIndex: 4, syllableStroke: null });
  });

  test("matches combined selection suffixes", () => {
    expect(getCandidateSelectionMatch("KAOT")).toEqual({ candidateIndex: 0, syllableStroke: "KAO" });
    expect(getCandidateSelectionMatch("KAOTS")).toEqual({ candidateIndex: 1, syllableStroke: "KAO" });
    expect(getCandidateSelectionMatch("KAOS")).toEqual({ candidateIndex: 2, syllableStroke: "KAO" });
    expect(getCandidateSelectionMatch("KAOD")).toEqual({ candidateIndex: 3, syllableStroke: "KAO" });
    expect(getCandidateSelectionMatch("KAOZ")).toEqual({ candidateIndex: 4, syllableStroke: "KAO" });
  });

  test("does not treat bare left-hand keys as candidate selection", () => {
    expect(getCandidateSelectionMatch("T")).toBeNull();
    expect(getCandidateSelectionMatch("TS")).toBeNull();
    expect(getCandidateSelectionMatch("S")).toBeNull();
    expect(getCandidateSelectionMatch("D")).toBeNull();
    expect(getCandidateSelectionMatch("Z")).toBeNull();
  });
});
