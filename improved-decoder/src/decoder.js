/**
 * Synthesized-artifact seed.
 *
 * Training replaces MODEL with a compact public-corpus-derived table. The
 * decoder still generates complete candidates and uses KenLM for contextual
 * scoring; it is not allowed to call the repository's existing beam search.
 */
import data from "../generated/model.js";

const MODEL = Object.create(null);
const CONTEXT = Object.create(null);
for (const row of data.split("\n")) {
  if (!row) continue;
  const fields = row.split("\t");
  if (fields.length === 3) {
    const [code, phrase, encodedBonus] = fields;
    (MODEL[code] ||= Object.create(null))[phrase] = Number(encodedBonus) / 4;
  } else {
    const [leftWord, code, phrase, encodedBonus] = fields;
    CONTEXT[`${leftWord}\t${code}`] = [phrase, Number(encodedBonus) / 4];
  }
}

export default function infer(input, api) {
  const slots = api.enumerate(input.v7Island);
  let sequences = [[]];
  for (const slot of slots) {
    const next = [];
    for (const prefix of sequences) {
      for (const syllable of slot) next.push(prefix.concat(syllable));
    }
    sequences = next;
  }

  const prior = MODEL[input.v7Island];
  const leftWords = input.fixedLeftText
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .match(/\p{L}+/gu);
  const contextual =
    leftWords &&
    CONTEXT[`${leftWords[leftWords.length - 1]}\t${input.v7Island}`];
  sequences.sort((left, right) => {
    const leftText = left.join(" ");
    const rightText = right.join(" ");
    const leftScore =
      api.kenlmScore(left) +
      (prior && prior[leftText] ? prior[leftText] : 0) +
      (contextual && contextual[0] === leftText ? contextual[1] : 0);
    const rightScore =
      api.kenlmScore(right) +
      (prior && prior[rightText] ? prior[rightText] : 0) +
      (contextual && contextual[0] === rightText ? contextual[1] : 0);
    return rightScore - leftScore || leftText.localeCompare(rightText);
  });
  return sequences
    .slice(0, input.maxCandidates)
    .map((sequence) => sequence.join(" "));
}
