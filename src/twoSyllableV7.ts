/** Parsing and reversible dictionary-mode transforms for two-syllable V7. */

export type TwoSyllableStrokeDecode = {
  v7Code: string;
  canonicalStroke: string;
};

const consonants: Record<number, string> = {
  0: "0",
  11: "b",
  5: "k",
  29: "d",
  7: "dd",
  12: "ph",
  15: "g",
  16: "h",
  30: "z",
  23: "kh",
  19: "l",
  24: "m",
  28: "n",
  31: "nh",
  13: "ng",
  8: "p",
  17: "r",
  14: "s",
  4: "t",
  20: "th",
  21: "tr",
  9: "v",
  25: "x",
  3: "w",
  22: "ch",
};

const remapTone = (tone: number): number =>
  tone === 3 ? 4 : tone === 4 ? 3 : tone === 5 ? 6 : tone === 6 ? 5 : tone;

const ordered = (value: string, alphabet: string): boolean => {
  let last = -1;
  for (const char of value) {
    const position = alphabet.indexOf(char);
    if (position <= last) return false;
    last = position;
  }
  return true;
};

function decodeParts(left: string, right: string): string | null {
  if (!ordered(left, "#STKPWHRAO") || !ordered(right, "EUFRPBLGTSDZ"))
    return null;
  const bit = (keys: string, key: string) => Number(keys.includes(key));
  const hasD = right.includes("D");
  const hasZ = right.includes("Z");
  const leftVowel = bit(left, "A") + 2 * bit(left, "O");
  const rightVowel = bit(right, "U") + 2 * bit(right, "E");
  // D and Z aliases are reserved exclusively for dictionary mode.
  if (hasD && leftVowel !== 0) return null;
  if (hasZ && rightVowel !== 0) return null;
  const leftConsonant =
    bit(left, "#") +
    2 * bit(left, "S") +
    4 * bit(left, "T") +
    8 * bit(left, "P") +
    16 * bit(left, "H");
  const rightConsonant =
    bit(right, "T") +
    2 * bit(right, "S") +
    4 * bit(right, "L") +
    8 * bit(right, "P") +
    16 * bit(right, "F");
  const c1 = consonants[leftConsonant];
  const c2 = consonants[rightConsonant];
  if (c1 === undefined || c2 === undefined) return null;
  const vowels = ["e", "a", "o", "i"];
  const v1 = leftVowel === 0 && hasD ? "u" : vowels[leftVowel];
  const v2 = rightVowel === 0 && hasZ ? "u" : vowels[rightVowel];
  const t1 = bit(left, "K") + 2 * bit(left, "W") + 4 * bit(left, "R");
  const t2 = bit(right, "G") + 2 * bit(right, "B") + 4 * bit(right, "R");
  return `${c1}${v1}${remapTone(t1)}${c2}${v2}${remapTone(t2)}`;
}

export function decodeCanonicalTwoSyllableStroke(
  stroke: string,
): TwoSyllableStrokeDecode | null {
  const match = /^([#STKPWHRAO]*)\*([EUFRPBLGTSDZ]*)$/.exec(stroke);
  if (!match) return null;
  const v7Code = decodeParts(match[1], match[2]);
  return v7Code === null ? null : { v7Code, canonicalStroke: stroke };
}

export function dictionaryStrokeForCanonicalStroke(
  stroke: string,
): string | null {
  if (!decodeCanonicalTwoSyllableStroke(stroke)) return null;
  const [left, right] = stroke.split("*");
  const leftLow = !left.includes("A") && !left.includes("O");
  const rightLow = !right.includes("U") && !right.includes("E");
  if (leftLow && rightLow) {
    const leftFlag = right.includes("D") ? "O" : "";
    const rightFlag = right.includes("Z") ? "E" : "";
    const middle = `${leftFlag}${rightFlag}`;
    const rightBody = right.replace(/[DZ]/g, "");
    return middle ? `${left}${middle}${rightBody}DZ` : `${left}-${rightBody}DZ`;
  }
  const withoutSuffix = right.replace(/[DZ]/g, "");
  return `${left}*${withoutSuffix}${right.includes("D") ? "" : "D"}${right.includes("Z") ? "" : "Z"}`;
}

export function decodeDictionaryModeStroke(
  stroke: string,
): TwoSyllableStrokeDecode | null {
  const starred = /^([#STKPWHRAO]*)\*([EUFRPBLGTSDZ]*)$/.exec(stroke);
  let source: string;
  if (starred) {
    if (decodeCanonicalTwoSyllableStroke(stroke)) return null;
    const [left, right] = [starred[1], starred[2]];
    if (
      !(right.includes("D") && /[AO]/.test(left)) &&
      !(right.includes("Z") && /[EU]/.test(right))
    )
      return null;
    const base = right.replace(/[DZ]/g, "");
    source = `${left}*${base}${right.includes("D") ? "" : "D"}${right.includes("Z") ? "" : "Z"}`;
  } else {
    if ((stroke.match(/-/g) ?? []).length > 1) return null;
    const normalized = stroke.replace("-", "");
    const corner = /^([#STKPWHR]*)(O?)(E?)([FRPBLGTS]*)DZ$/.exec(normalized);
    if (
      !corner ||
      !ordered(corner[1], "#STKPWHR") ||
      !ordered(corner[4], "FRPBLGTS")
    )
      return null;
    source = `${corner[1]}*${corner[4]}${corner[2] ? "D" : ""}${corner[3] ? "Z" : ""}`;
  }
  const decoded = decodeCanonicalTwoSyllableStroke(source);
  if (!decoded || dictionaryStrokeForCanonicalStroke(source) !== stroke)
    return null;
  return decoded;
}
