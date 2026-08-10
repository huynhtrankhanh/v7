import assert from "node:assert/strict";
import test from "node:test";
import { cards } from "../src/drills.mjs";
import { sentenceCards } from "../src/sentences.mjs";
import { strokeForV7Pair } from "../src/v7-stroke.mjs";

const stenoForCode = {
  KeyQ: "#",
  KeyW: "T-",
  KeyE: "P-",
  KeyR: "H-",
  KeyF: "R-",
  KeyC: "A",
  KeyV: "O",
  KeyN: "E",
  KeyM: "U",
  Space: "*",
  KeyU: "-F",
  KeyJ: "-R",
  KeyI: "-P",
  KeyK: "-B",
  KeyO: "-L",
  KeyL: "-G",
  KeyP: "-T",
  Semicolon: "-S",
  KeyT: "-D",
  KeyY: "-Z",
  KeyA: "S-",
  KeyS: "K-",
  KeyD: "W-",
};
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

function serializeKeys(keys) {
  const tokens = new Set(keys.map((key) => stenoForCode[key]));
  const hasMiddle = ["A", "O", "*", "E", "U"].some((token) =>
    tokens.has(token),
  );
  let stroke = "";
  let hyphen = false;
  for (const [index, token] of strokeOrder.entries()) {
    if (
      !hasMiddle &&
      !hyphen &&
      index >= strokeOrder.indexOf("-F") &&
      tokens.has(token)
    ) {
      stroke += "-";
      hyphen = true;
    }
    if (tokens.has(token)) stroke += token.replace("-", "");
  }
  return stroke;
}

test("every sentence pair has a generated physical V7 hint", () => {
  assert.ok(sentenceCards.length >= 30);
  assert.equal(
    new Set(sentenceCards.map((sentence) => sentence.id)).size,
    sentenceCards.length,
  );
  for (const sentence of sentenceCards) {
    for (const pair of sentence.pairs) {
      assert.deepEqual(strokeForV7Pair(pair.code), {
        stroke: pair.stroke,
        keys: pair.keys,
      });
      assert.ok(pair.stroke.includes("*"), `${sentence.id}: ${pair.words}`);
      assert.ok(pair.keys.includes("Space"), `${sentence.id}: ${pair.words}`);
      if (pair.dictionaryStroke !== null) {
        assert.notEqual(pair.dictionaryStroke, pair.stroke);
      }
    }
  }
});

test("known V7 examples generate the production editor strokes", () => {
  assert.deepEqual(strokeForV7Pair("na0tro2"), {
    stroke: "TPHA*EFBLT",
    keys: [
      "KeyW",
      "KeyE",
      "KeyR",
      "KeyC",
      "Space",
      "KeyN",
      "KeyU",
      "KeyK",
      "KeyO",
      "KeyP",
    ],
  });
});

test("curriculum covers each core physical operation", () => {
  for (const concept of [
    "vowel",
    "onset",
    "tone",
    "coda",
    "orthography",
    "punctuation",
    "control",
    "repair",
  ]) {
    assert.ok(
      cards.some((card) => card.concept === concept),
      `missing curriculum concept: ${concept}`,
    );
  }
  assert.ok(cards.filter((card) => card.concept === "vowel").length >= 15);
  assert.ok(cards.filter((card) => card.concept === "onset").length >= 22);
  assert.ok(cards.filter((card) => card.concept === "coda").length >= 10);
  assert.ok(cards.filter((card) => card.concept === "punctuation").length >= 4);
  assert.equal(cards.filter((card) => card.kind === "sentence").length, 30);
  assert.ok(cards.filter((card) => card.kind === "inference").length >= 7);
  for (const entryStroke of ["T", "P", "H", "TK"]) {
    assert.ok(
      cards.some((card) => card.piecemeal?.entryStroke === entryStroke),
      `missing correction entry: ${entryStroke}`,
    );
  }
  for (const target of ["oa", "quo", "đoa", "ngoa", "ngoe", "mia", "banh"]) {
    assert.equal(
      cards.some((card) => card.target === target),
      false,
      `non-lexical drill target remains: ${target}`,
    );
  }
});

test("physical keys for every non-inference card produce its advertised stroke", () => {
  for (const card of cards.filter(
    (item) => item.kind === "deterministic" || item.kind === "control",
  )) {
    assert.equal(serializeKeys(card.keys), card.strokes[0], card.id);
  }
});
