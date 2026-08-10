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

  test("is a bijection over all 1,000,000 canonical pair states", () => {
    const consonantValues = [
      0, 11, 5, 29, 7, 12, 15, 16, 30, 23, 19, 24, 28, 31, 13, 8, 17, 14, 4, 20,
      21, 9, 25, 3, 22,
    ];
    const bits = (value: number, keys: string[]) =>
      keys.filter((_, index) => value & (1 << index)).join("");
    const leftVowels = ["", "D", "A", "O", "AO"];
    const rightVowels = ["", "Z", "U", "E", "EU"];
    const targets = new Set<string>();
    let sources = 0;
    for (const leftConsonant of consonantValues)
      for (let leftTone = 0; leftTone < 8; leftTone += 1)
        for (const leftVowel of leftVowels)
          for (const rightConsonant of consonantValues)
            for (let rightTone = 0; rightTone < 8; rightTone += 1)
              for (const rightVowel of rightVowels) {
                const leftKeys = new Set(
                  `${bits(leftConsonant, ["#", "S", "T", "P", "H"])}${bits(leftTone, ["K", "W", "R"])}${leftVowel.replace("D", "")}`,
                );
                const left = [..."#STKPWHRAO"]
                  .filter((key) => leftKeys.has(key))
                  .join("");
                const rightKeys = new Set(
                  `${rightVowel.replace("Z", "")}${bits(rightConsonant, ["T", "S", "L", "P", "F"])}${bits(rightTone, ["G", "B", "R"])}${leftVowel.includes("D") ? "D" : ""}${rightVowel.includes("Z") ? "Z" : ""}`,
                );
                const right = [..."EUFRPBLGTSDZ"]
                  .filter((key) => rightKeys.has(key))
                  .join("");
                const source = `${left}*${right}`;
                const target = dictionaryStrokeForCanonicalStroke(source);
                if (target === null)
                  throw new Error(`missing target for ${source}`);
                const recovered = decodeDictionaryModeStroke(target);
                const decoded = decodeCanonicalTwoSyllableStroke(source);
                if (
                  recovered?.canonicalStroke !== source ||
                  recovered.v7Code !== decoded?.v7Code
                )
                  throw new Error(
                    `round-trip failed for ${source} via ${target}`,
                  );
                targets.add(target!);
                sources += 1;
              }
    expect(sources).toBe(1_000_000);
    expect(targets.size).toBe(sources);
  }, 120_000);
});
