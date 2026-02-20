import { extractCandidateSelection } from "../src/candidateSelection";

describe("candidate selection stroke mapping", () => {
  it("maps selector-only strokes to the right candidate index", () => {
    expect(extractCandidateSelection("-T")).toEqual({ index: 0, remainingStroke: "" });
    expect(extractCandidateSelection("-TS")).toEqual({ index: 1, remainingStroke: "" });
    expect(extractCandidateSelection("-S")).toEqual({ index: 2, remainingStroke: "" });
    expect(extractCandidateSelection("-D")).toEqual({ index: 3, remainingStroke: "" });
    expect(extractCandidateSelection("-Z")).toEqual({ index: 4, remainingStroke: "" });
  });

  it("supports combined syllable stroke with candidate selection suffix", () => {
    expect(extractCandidateSelection("KAT")).toEqual({ index: 0, remainingStroke: "KA" });
    expect(extractCandidateSelection("KA-TS")).toEqual({ index: 1, remainingStroke: "KA" });
    expect(extractCandidateSelection("PAZ")).toEqual({ index: 4, remainingStroke: "PA" });
  });

  it("does not match deprecated selector strokes", () => {
    expect(extractCandidateSelection("TK")).toBeNull();
    expect(extractCandidateSelection("PW")).toBeNull();
    expect(extractCandidateSelection("HR")).toBeNull();
    expect(extractCandidateSelection("-FR")).toBeNull();
    expect(extractCandidateSelection("-PB")).toBeNull();
  });
});
