import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../../data/two_syllable_dictionary.txt", import.meta.url),
  "utf8",
);

export const lexicalPairs = new Set(
  source
    .split(/\r?\n/u)
    .map((line) => line.trim().normalize("NFC").toLocaleLowerCase("vi"))
    .filter(Boolean),
);

export const hasLexicalPair = (pair) =>
  lexicalPairs.has(pair.trim().normalize("NFC").toLocaleLowerCase("vi"));
