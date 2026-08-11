const consonantValues = {
  0: 0,
  b: 11,
  k: 5,
  d: 29,
  dd: 7,
  ph: 12,
  g: 15,
  h: 16,
  z: 30,
  kh: 23,
  l: 19,
  m: 24,
  n: 28,
  nh: 31,
  ng: 13,
  p: 8,
  r: 17,
  s: 14,
  t: 4,
  th: 20,
  tr: 21,
  v: 9,
  w: 3,
  x: 25,
  ch: 22,
};

const consonants = Object.keys(consonantValues).sort(
  (a, b) => b.length - a.length,
);
const strokeOrder = [
  "#",
  "S-",
  "T-",
  "K-",
  "P-",
  "W-",
  "H-",
  "R-",
  "A",
  "O",
  "*",
  "E",
  "U",
  "-F",
  "-R",
  "-P",
  "-B",
  "-L",
  "-G",
  "-T",
  "-S",
  "-D",
  "-Z",
];
const physicalKey = {
  "#": "KeyQ",
  "S-": "KeyA",
  "T-": "KeyW",
  "K-": "KeyS",
  "P-": "KeyE",
  "W-": "KeyD",
  "H-": "KeyR",
  "R-": "KeyF",
  A: "KeyC",
  O: "KeyV",
  "*": "Space",
  E: "KeyN",
  U: "KeyM",
  "-F": "KeyU",
  "-R": "KeyJ",
  "-P": "KeyI",
  "-B": "KeyK",
  "-L": "KeyO",
  "-G": "KeyL",
  "-T": "KeyP",
  "-S": "Semicolon",
  "-D": "KeyT",
  "-Z": "KeyY",
};

function parseSyllable(code, offset) {
  const consonant = consonants.find((candidate) =>
    code.startsWith(candidate, offset),
  );
  if (consonant === undefined) throw new Error(`Mã V7 không hợp lệ: ${code}`);
  const vowelOffset = offset + consonant.length;
  const vowel = code[vowelOffset];
  const tone = Number(code[vowelOffset + 1]);
  if (
    !/[aeiou]/.test(vowel) ||
    !Number.isInteger(tone) ||
    tone < 0 ||
    tone > 7
  ) {
    throw new Error(`Mã V7 không hợp lệ: ${code}`);
  }
  return {
    consonant,
    vowel,
    tone,
    nextOffset: vowelOffset + 2,
  };
}

const inverseTone = (tone) => {
  if (tone === 3) return 4;
  if (tone === 4) return 3;
  if (tone === 5) return 6;
  if (tone === 6) return 5;
  return tone;
};

function addBits(tokens, value, bitTokens) {
  bitTokens.forEach((token, index) => {
    if (value & (1 << index)) tokens.add(token);
  });
}

export function strokeForV7Pair(code) {
  const left = parseSyllable(code, 0);
  const right = parseSyllable(code, left.nextOffset);
  if (right.nextOffset !== code.length)
    throw new Error(`Mã V7 không hợp lệ: ${code}`);

  const tokens = new Set(["*"]);
  addBits(tokens, consonantValues[left.consonant], [
    "#",
    "S-",
    "T-",
    "P-",
    "H-",
  ]);
  addBits(tokens, inverseTone(left.tone), ["K-", "W-", "R-"]);
  if (left.vowel === "a") tokens.add("A");
  else if (left.vowel === "o") tokens.add("O");
  else if (left.vowel === "i") {
    tokens.add("A");
    tokens.add("O");
  } else if (left.vowel === "u") tokens.add("-D");

  addBits(tokens, consonantValues[right.consonant], [
    "-T",
    "-S",
    "-L",
    "-P",
    "-F",
  ]);
  addBits(tokens, inverseTone(right.tone), ["-G", "-B", "-R"]);
  if (right.vowel === "a") tokens.add("U");
  else if (right.vowel === "o") tokens.add("E");
  else if (right.vowel === "i") {
    tokens.add("U");
    tokens.add("E");
  } else if (right.vowel === "u") tokens.add("-Z");

  const ordered = strokeOrder.filter((token) => tokens.has(token));
  return {
    stroke: ordered.map((token) => token.replace("-", "")).join(""),
    keys: ordered.map((token) => physicalKey[token]),
  };
}

export function dictionaryStrokeForV7Pair(code) {
  const left = parseSyllable(code, 0);
  const right = parseSyllable(code, left.nextOffset);
  if (right.nextOffset !== code.length)
    throw new Error(`Mã V7 không hợp lệ: ${code}`);
  const ordinary = strokeForV7Pair(code).stroke;
  const [leftStroke, rightStroke] = ordinary.split("*");
  if (["e", "u"].includes(left.vowel) && ["e", "u"].includes(right.vowel)) {
    const flags = `${left.vowel === "u" ? "O" : ""}${right.vowel === "u" ? "E" : ""}`;
    const rightBody = rightStroke.replace(/[DZ]/g, "");
    return flags
      ? `${leftStroke}${flags}${rightBody}DZ`
      : `${leftStroke}-${rightBody}DZ`;
  }
  const body = rightStroke.replace(/[DZ]/g, "");
  return `${leftStroke}*${body}${rightStroke.includes("D") ? "" : "D"}${rightStroke.includes("Z") ? "" : "Z"}`;
}
