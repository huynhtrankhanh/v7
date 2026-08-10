import {
  decodeCanonicalTwoSyllableStroke,
  decodeDictionaryModeStroke,
  dictionaryStrokeForCanonicalStroke,
} from "../src/twoSyllableV7";

describe("two-syllable V7 dictionary mode", () => {
  test.each([
    ["*", "-DZ"],
    ["*Z", "EDZ"],
    ["*D", "ODZ"],
    ["*DZ", "OEDZ"],
    ["TA*U", "TA*UDZ"],
    ["TA*Z", "TA*D"],
  ])("round trips %s through %s", (ordinary, dictionary) => {
    expect(dictionaryStrokeForCanonicalStroke(ordinary)).toBe(dictionary);
    expect(decodeDictionaryModeStroke(dictionary)).toEqual(
      decodeCanonicalTwoSyllableStroke(ordinary),
    );
    expect(decodeCanonicalTwoSyllableStroke(dictionary)).toBeNull();
  });

  test("rejects redundant ordinary aliases and noncanonical sources", () => {
    expect(decodeCanonicalTwoSyllableStroke("A*D")).toBeNull();
    expect(decodeCanonicalTwoSyllableStroke("*UZ")).toBeNull();
    expect(dictionaryStrokeForCanonicalStroke("A*D")).toBeNull();
  });
});
