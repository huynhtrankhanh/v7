import {
  assembleSyllable,
  finalMap,
  parseSyllableStroke,
  stenographyMap,
  toneMap,
  vowelMap,
} from "./syllableStroke";
import { getV7Code } from "./v7Core";

let validVietnameseSyllables: Set<string> | null = null;

export function isValidVietnameseSyllable(syllable: string): boolean {
  return getValidVietnameseSyllables().has(syllable.toLocaleLowerCase("vi"));
}

/** Decode a stroke only when its result belongs to the V7 regex lattice. */
export function decodeV7PermittedSyllableStroke(stroke: string): string | null {
  const parsed = parseSyllableStroke(stroke);
  if (!parsed) return null;

  const syllable = assembleSyllable(parsed);
  return getV7Code(syllable.toLocaleLowerCase("vi")) === undefined
    ? null
    : syllable;
}

export function getValidVietnameseSyllables(): Set<string> {
  if (validVietnameseSyllables) return validVietnameseSyllables;

  const syllables = new Set<string>();
  const initialKeys = ["", ...Object.keys(stenographyMap)];
  const vowelKeys = Object.keys(vowelMap);
  const finalKeys = ["", ...Object.keys(finalMap)];
  const toneKeys = ["", ...Object.keys(toneMap)];

  for (const onGlide of [false, true]) {
    for (const initial of initialKeys) {
      for (const vowel of vowelKeys) {
        for (const final of finalKeys) {
          for (const tone of toneKeys) {
            const parsed = parseSyllableStroke(
              `${onGlide ? "S" : ""}${initial}${vowel}${final}${tone}`,
            );
            if (parsed) syllables.add(assembleSyllable(parsed));
          }
        }
      }
    }
  }

  validVietnameseSyllables = syllables;
  return validVietnameseSyllables;
}
