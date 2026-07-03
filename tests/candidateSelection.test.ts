import {
  getCandidateSelectionMatch,
  getFirstCandidateAppendStroke,
  isLoneCandidateSelectionStroke
} from "../src/candidateSelection";

describe("getCandidateSelectionMatch", () => {
  test("matches lone candidate selection strokes", () => {
    expect(getCandidateSelectionMatch("-T")).toEqual({ candidateIndex: 0, syllableStroke: null });
    expect(getCandidateSelectionMatch("-TS")).toEqual({ candidateIndex: 1, syllableStroke: null });
    expect(getCandidateSelectionMatch("-S")).toEqual({ candidateIndex: 2, syllableStroke: null });
    expect(getCandidateSelectionMatch("-D")).toEqual({ candidateIndex: 3, syllableStroke: null });
    expect(getCandidateSelectionMatch("-Z")).toEqual({ candidateIndex: 4, syllableStroke: null });
    expect(isLoneCandidateSelectionStroke("-T")).toBe(true);
    expect(isLoneCandidateSelectionStroke("KAOT")).toBe(false);
  });

  test("does not match selections that exceed available candidates", () => {
    expect(getCandidateSelectionMatch("-S", 2)).toBeNull();
    expect(getCandidateSelectionMatch("KAOD", 3)).toBeNull();
  });

  test("matches combined selection suffixes", () => {
    expect(getCandidateSelectionMatch("KAOT")).toEqual({ candidateIndex: 0, syllableStroke: "KAO" });
    expect(getCandidateSelectionMatch("KAOTS")).toEqual({ candidateIndex: 1, syllableStroke: "KAO" });
    expect(getCandidateSelectionMatch("KAOS")).toEqual({ candidateIndex: 2, syllableStroke: "KAO" });
    expect(getCandidateSelectionMatch("KAOD")).toEqual({ candidateIndex: 3, syllableStroke: "KAO" });
    expect(getCandidateSelectionMatch("KAOZ")).toEqual({ candidateIndex: 4, syllableStroke: "KAO" });
  });

  test("treats single syllable plus T as first-candidate selection plus appended syllable", () => {
    expect(getCandidateSelectionMatch("KAOT", 1)).toEqual({ candidateIndex: 0, syllableStroke: "KAO" });
    expect(getFirstCandidateAppendStroke("KAOT")).toBe("KAO");
    expect(getFirstCandidateAppendStroke("KAOTS")).toBeNull();
  });

  test("matches combined suffixes for punctuation strokes", () => {
    expect(getCandidateSelectionMatch("TP-PLT")).toEqual({ candidateIndex: 0, syllableStroke: "TP-PL" });
    expect(getCandidateSelectionMatch("KW-BGTS")).toEqual({ candidateIndex: 1, syllableStroke: "KW-BG" });
  });

  test("matches combined suffixes with invalid syllable strokes", () => {
    expect(getCandidateSelectionMatch("TS")).toEqual({ candidateIndex: 2, syllableStroke: "T" });
    expect(getCandidateSelectionMatch("SD")).toEqual({ candidateIndex: 3, syllableStroke: "S" });
    expect(getCandidateSelectionMatch("TZ")).toEqual({ candidateIndex: 4, syllableStroke: "T" });
  });
});
