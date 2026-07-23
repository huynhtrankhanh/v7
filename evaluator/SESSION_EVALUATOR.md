# Causal IME session evaluator

`evaluateImeSession.ts` replays complete typing sessions through the editing
model used by the WebUI and Android IME. It is the primary evaluator for claims
about user-facing IME behavior. The older `evaluateInference.ts` remains useful
as a fast local ranking diagnostic.

## Why this evaluator exists

The local inconvenience score evaluates each one- or two-syllable V7 island
independently with the ground-truth prefix. That made decoder iteration cheap
and exposed useful search headroom, but the decoder experiment established
several limitations:

- a wrong prediction never became context for a later prediction;
- later evidence could not revise an unresolved earlier island;
- every error was detected and corrected immediately;
- candidate ranks 2 through 5 all cost one action and no inspection effort;
- correction had no nine-syllable addressing limit, cursor travel, commit,
  selection, deletion, or re-entry;
- punctuation and Android composing-session boundaries were absent; and
- fixed input was supplied for free.

The session evaluator keeps the useful legality and latency gates while making
those assumptions explicit and causal.

## Product editing model

The implementation follows the actual state transitions in `src/main.ts`,
`src/webCore.ts`, `src/textBuffer.ts`, and `V7ImeService`:

1. V7 islands remain unresolved in one live composition. Every later inference
   request contains all unresolved islands and the actual fixed text between
   them, so later evidence may revise an earlier preview.
2. Candidate 1 is the text shown in the host editor. Selecting any candidate
   collapses the entire composition into fixed text.
3. A punctuation chord accepts candidate 1 before appending punctuation.
   Candidate selection can be combined with punctuation in the same chord, so
   clause-time recovery does not invent a second physical action.
4. Normal single spaces adjacent to V7 text come from the IME's smart-spacing
   rules. They neither cost a stroke nor cause a separate inference call.
   Forced and nonstandard spaces are fixed-entry strokes and do cause updates.
5. Piecemeal mode can directly address only the nine rightmost Vietnamese
   syllables. One entry chord starts a contiguous forward replacement range.
6. An older error is recovered through the Android editor model: finalize the
   composing text without deleting it, move the cursor, extend a selection,
   delete, retype deterministic syllables, and return to the insertion point.
7. A cursor move, editor change, or explicit `[` finalization preserves the
   visible preedit as committed text and starts a clean V7 session.
8. Every candidate must preserve fixed text and every V7 replacement must have
   the expected syllable count and round-trip to the requested compact code.
   Violations return `ILLEGAL`. A decoder deadline returns `TIMEOUT`.

The automatic planner uses predictive V7 for every word supported by
`getV7Code`, packs at most two adjacent syllables per chord, and charges
punctuation, layout, forced spacing, and fallback graphemes as fixed input.
Capitalization is ignored for decoder comparisons, matching the local
evaluator. A future trace-ingestion adapter can replace the deterministic
planner without changing the replay metrics.

## Detection scenarios

User attention is not hidden in one favorable scalar. `evaluateImeScenarios`
runs a sensitivity curve:

| Policy                     | Behavior                                                                     |
| -------------------------- | ---------------------------------------------------------------------------- |
| `never`                    | Free-running causal replay; accept automatic preview commits only            |
| `immediate`                | Inspect after each V7 entry                                                  |
| `after-v7: 1`, `3`, or `5` | Wait a fixed number of later V7 entries after the first visible error        |
| `clause`                   | Inspect before clause punctuation, allowing combined selection + punctuation |
| `end`                      | Inspect once at the end of the message                                       |

Every correcting policy also performs a final inspection so a short session
does not silently escape a longer delay threshold. The free-running policy is
the scenario that reports uncorrected final error.

When correction is due, the policy uses this deterministic order:

1. select an exact visible whole-composition candidate;
2. use the cheapest legal contiguous piecemeal ranges within the rightmost
   nine syllables; and
3. use committed editor recovery for older or structurally different text.

This order is product-realistic but still represents a declared, attentive
user policy. It is not a claim that all users notice errors at the same time or
choose the same recovery.

## Metrics

The result is vector-valued. Do not rank decoders from `interactionCost` alone.
Each scenario reports:

- physical V7 and fixed-entry actions;
- standalone and combined candidate selections;
- candidate inspection distance and selected ranks;
- piecemeal entries and replacements;
- commits, cursor moves, selection extensions, deletions, and deterministic
  retypes;
- final syllable edit error and exactness;
- error-cascade lengths and the fraction that survive more than one predictive
  update;
- V7 entries from error creation to recovery; and
- inference p50, p95, and maximum latency observed during incremental replay.

`physicalActions` is the unweighted count of physical operations.
`interactionCost` applies configurable weights; candidate inspection has a
default weight of zero so the default remains an action count while rank stays
visible as a separate metric. Supply measured `actionTimeMs` values to produce
`estimatedTimeMs`. Unspecified time components contribute zero—there is no
fabricated default typing speed.

Legality and timeout are hard failures, never numeric penalties. Production
qualification should still interrupt decoder code in an isolated worker or VM:
the generic TypeScript timeout can reject asynchronous work and detect a slow
synchronous return, but it cannot preempt arbitrary synchronous JavaScript in
the caller's thread.

The deterministic recovery planner charges a legal sequence and then applies
the corrected target atomically. It does not yet invoke inference after every
intermediate piecemeal replacement or search undo history for a cheaper
recovery. Consequently, its correction-action count is useful for paired
optimization, while recovery-time latency and transient candidates are not yet
a keystroke-perfect UI replay. Recorded action traces should add those two
paths before this metric is calibrated as a population typing-time estimate.

## API

```ts
import { evaluateImeScenarios, evaluateImeSession } from "./evaluateImeSession";

const inference = async (request: string[]) => {
  // Return either replacement-only arrays (one item per V7 island) or the
  // complete alternating [fixed, replacement, fixed, ...] shape.
  return [["trời mưa"], ["trời mua"]];
};

const immediate = await evaluateImeSession("trời mưa", inference, {
  policy: { kind: "immediate" },
  inferenceTimeoutMs: 50,
});

const sensitivity = await evaluateImeScenarios("trời mưa", inference);
```

The decoder must be deterministic when `evaluateImeScenarios` reuses the same
function across policies. Stateful decoders should provide a fresh instance
and call `evaluateImeSession` once per policy.

## Single program-synthesis measure

`synthesisObjective.ts` turns the scenario vector into one total order for an
automated search. The public synthesis entry point maps a program and fixed
corpus directly to its measure:

```ts
import {
  compareSynthesisObjectives,
  evaluateSynthesisMeasure,
  prepareSynthesisCorpus,
} from "./synthesisObjective";

// Do this once; reuse the segmented benchmark for every proposal.
const benchmark = prepareSynthesisCorpus(corpus);
const objective = await evaluateSynthesisMeasure(benchmark, inference, {
  inferenceTimeoutMs: 50,
  artifactBytes: compiledArtifact.length,
});

// Negative means proposal is better.
const order = compareSynthesisObjectives(objective, incumbentObjective);
```

The returned tuple is minimized lexicographically:

```text
(
  hard failure flag,
  failed scenario runs,
  illegal runs,
  timeout runs,
  free-running final syllable errors,
  worst correcting-policy physical actions,
  total correcting physical actions,
  p95 error-cascade length,
  total candidate-inspection steps,
  p95 inference latency in whole milliseconds,
  artifact bytes
)
```

The order is intentional:

1. Any legal, deadline-compliant program beats every failing program. Failure
   counts only provide search direction among proposals that are all
   ineligible; they never make failure a soft tradeoff.
2. Silent free-running error comes before correction convenience. A decoder
   cannot win by making unattended output worse but cheap to repair.
3. The worst correcting policy comes before the sum, preventing an improvement
   that depends on one favorable detection assumption.
4. Total correction work then measures broad benefit over the fixed sensitivity
   curve.
5. Cascade tails and inspection distance break behavioral ties that raw action
   totals hide.
6. Per-call deadlines already make severe latency a hard failure. Quantized
   p95 latency distinguishes feasible programs without pretending noisy
   microsecond measurements are stable.
7. Artifact size is the final tie-breaker after user behavior and latency.

Raw totals are used because synthesis compares programs on the same fixed
corpus and policy set; their denominators are identical. Freeze the corpus,
policy list, evaluator version, timeout, device class, and artifact compiler
for one search run. `prepareSynthesisCorpus` also avoids repeating Vietnamese
segmentation for every proposed program. `evaluateSynthesisMeasureDetailed`
returns the same tuple plus all scenario traces when the agent needs to explain
a change.

## Interpreting results

Use paired target sessions and compare decoders under every policy. A decoder
is a robust improvement when it lowers correction work without increasing
free-running final error, cascade tails, illegal output, or latency tails.
Keep the local evaluator beside this report: it helps explain whether a session
change came from candidate ranking, later-context revision, or recovery
behavior.

This evaluator is deliberately deterministic and uses no private typing
history. Detection distributions and action-time weights should only be
calibrated from a small study or explicit opt-in telemetry. Corpus-fit and
held-out generalization results must continue to be reported separately.
