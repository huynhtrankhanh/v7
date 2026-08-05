import { isV7PermittedSyllable } from "../src/vietnameseSyllables";

describe("v7-permitted syllables", () => {
  test("accepts syllables enumerated by the structured v7 regex map", () => {
    expect(isV7PermittedSyllable("cá")).toBe(true);
    expect(isV7PermittedSyllable("Quy")).toBe(true);
  });

  test("rejects orthographic syllables outside the structured v7 regex map in O(1)", () => {
    expect(isV7PermittedSyllable("gii")).toBe(false);
  });
});
