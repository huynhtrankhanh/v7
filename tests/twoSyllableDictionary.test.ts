import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getV7Code } from "../src/v7Core";

describe("bundled two-syllable lexical dictionary", () => {
  test("contains unique normalized pair-per-line V7 entries", () => {
    const source = readFileSync(
      resolve(__dirname, "../data/two_syllable_dictionary.txt"),
      "utf8",
    );
    const seen = new Set<string>();
    for (const [index, line] of source.split("\n").entries()) {
      if (index === source.split("\n").length - 1 && line === "") continue;
      expect(line).toBe(line.trim());
      expect(line).toBe(line.normalize("NFC"));
      const words = line.split(" ");
      expect(words).toHaveLength(2);
      expect(
        words.every(
          (word) => getV7Code(word.toLocaleLowerCase("vi")) !== undefined,
        ),
      ).toBe(true);
      const lookupKey = line.toLocaleLowerCase("vi");
      expect(seen.has(lookupKey)).toBe(false);
      seen.add(lookupKey);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  test("preserves intentional display capitalization", () => {
    const source = readFileSync(
      resolve(__dirname, "../data/two_syllable_dictionary.txt"),
      "utf8",
    );
    expect(source.split(/\r?\n/u)).toContain("Việt Nam");
  });
});
