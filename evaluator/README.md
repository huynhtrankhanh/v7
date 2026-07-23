# Inference inconvenience evaluator

The evaluator measures how many user actions are needed to enter target text
through the V7 engine. Lower is better.

## Model

Text is segmented into Vietnamese words. If `getV7Code` can represent a word,
the evaluator enters it in V7 mode. Representable words separated by one normal
space are packed two at a time because one V7 chord describes up to two
syllables. Capitalization is ignored when matching a prediction.

Everything else—including words outside the V7 inventory, emoji, punctuation,
and layout—is supplied as fixed text. Fixed text is still included as inference
context, but contributes **zero** to the score.

For each V7 island, the default costs are:

| Action                                 | Cost |
| -------------------------------------- | ---: |
| Enter the V7 island                    |    1 |
| Accept the first prediction            |    0 |
| Select another visible candidate       |    1 |
| Enter piecemeal-edit mode              |    1 |
| Replace one syllable in piecemeal mode |    1 |

Only the first five candidates are visible by default. The evaluator chooses
the cheaper of selecting an exact candidate and correcting the first candidate
piecemeal. Consecutive piecemeal replacements share one edit-mode entry; the
optimizer may also retype a correct syllable if that costs less than entering
edit mode again.

Examples:

- Perfect two-syllable prediction: `1` (one V7 entry).
- Target is the second candidate: `2` (entry + candidate selection).
- One syllable of the first candidate is wrong: `3` (entry + piecemeal entry +
  one replacement).
- Text containing no V7-representable syllables: `0`.

This is an interaction-cost metric, not an edit-distance or language-quality
metric. It intentionally does not charge for the mechanism that supplies fixed
text.

## API

```ts
import {
  evaluate,
  evaluateDetailed,
  type InferenceFunction,
} from "./evaluateInference";

const inference: InferenceFunction = async (request) => {
  // request alternates [fixed text, compact V7, fixed text].
  return [["trời mưa"], ["trời mua"]];
};

const score = await evaluate("trời mưa", inference);
const result = await evaluateDetailed("trời mưa", inference);
```

An inference candidate may be:

- a string containing the V7 island replacement;
- a one-element replacement array, as returned by the current inference API;
- a full alternating array with the same shape as the request; or
- a fully rendered string beginning with the fixed prefix.

`evaluateDetailed` returns the total and a per-island trace containing the
compact V7 request, top prediction, chosen correction strategy, and cost. Use
`evaluate` when only the numeric score is needed.

If inference returns any candidate whose replacement does not round-trip to
the requested V7 island, both functions return `"ILLEGAL"` instead of a
numeric score. A legal replacement contains only whitespace-separated
Vietnamese syllables, and the concatenated V7 codes of those syllables must
exactly equal the requested island. This makes the evaluator suitable for
testing generated decoders without rewarding outputs that cannot be typed in
V7.

`EvaluationOptions` can change the candidate limit, island size, and individual
action weights. All weights must be finite and non-negative.
