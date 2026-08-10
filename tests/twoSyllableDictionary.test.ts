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
      expect(line).toBe(line.toLocaleLowerCase("vi"));
      const words = line.split(" ");
      expect(words).toHaveLength(2);
      expect(words.every((word) => getV7Code(word) !== undefined)).toBe(true);
      expect(seen.has(line)).toBe(false);
      seen.add(line);
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});
