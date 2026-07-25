import assert from "node:assert/strict";
import test from "node:test";
import { sentenceCards } from "../src/sentences.mjs";
import { strokeForV7Pair } from "../src/v7-stroke.mjs";

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
