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
for (const row of data[0].split("\n")) {
  if (!row) continue;
  const [code, phrase, encodedBonus] = row.split("\t");
  (MODEL[code] ||= Object.create(null))[phrase] = Number(encodedBonus) / 4;
}
for (const row of data[1].split("\n")) {
  if (!row) continue;
  const [leftWord, code, phrase] = row.split("\t");
  CONTEXT[`${leftWord}\t${code}`] = phrase;
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
  return sequences
    .map((sequence) => {
      const text = sequence.join(" ");
      return [
        text,
        api.kenlmScore(sequence) +
          (prior && prior[text] ? prior[text] : 0) +
          (contextual === text ? 12 : 0),
      ];
    })
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, input.maxCandidates)
    .map((candidate) => candidate[0]);
}
