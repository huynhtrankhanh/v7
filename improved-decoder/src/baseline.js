/**
 * Reference decoder for the synthesis experiment.
 *
 * The host supplies complete legal V7 slots and precomputed KenLM continuation
 * scores. This program owns candidate construction: it enumerates every legal
 * sequence and returns the five highest-scoring complete candidates.
 */
export default function infer(input, api) {
  let sequences = [[]];
  for (const slot of api.enumerate(input.v7Island)) {
    const next = [];
    for (const prefix of sequences) {
      for (const syllable of slot) next.push(prefix.concat(syllable));
    }
    sequences = next;
  }

  sequences.sort((left, right) => {
    const scoreDifference = api.kenlmScore(right) - api.kenlmScore(left);
    return scoreDifference || left.join(" ").localeCompare(right.join(" "));
  });
  return sequences
    .slice(0, input.maxCandidates)
    .map((sequence) => sequence.join(" "));
}
