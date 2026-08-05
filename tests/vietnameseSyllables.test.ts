import { decodeV7PermittedSyllableStroke } from "../src/vietnameseSyllables";

describe("V7-permitted single-syllable strokes", () => {
  test("accepts decoded syllables enumerated by the V7 regexes", () => {
    expect(decodeV7PermittedSyllableStroke("OEU")).toBe("ia");
  });

  test("rejects parseable strokes outside the V7 regex lattice", () => {
    // The broad stroke grammar can assemble this as `yêi`, but no V7 regex
    // enumerates that syllable, so the caller can continue down its cascade.
    expect(decodeV7PermittedSyllableStroke("OEUFP")).toBeNull();
  });

  test("validates capitalization against the lowercase V7 syllable", () => {
    expect(decodeV7PermittedSyllableStroke("#OEU")).toBe("Ia");
  });
});
