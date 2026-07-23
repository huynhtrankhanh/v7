# Training and optimization lessons

## What “training” means here

This experiment does not train a neural model. A coding agent writes ordinary
JavaScript and a deterministic corpus compiler builds a small data artifact.
The runtime decoder has access only to:

- the V7 code for the current one- or two-syllable island;
- fixed left context;
- legal syllable enumeration supplied by the host; and
- word 3-gram scores supplied by KenLM.

It has no GPU, model API, network, filesystem, user history, personalization,
or access to the existing production beam search. The compiled decoder must be
at most 51,200 bytes and every returned phrase must round-trip to the input V7
code.

The current experiment is deliberately transductive, or corpus-fit:
`evaluator/dataset.json` is both the source of synthesized rules and the scored
corpus. The results measure how much useful structure can be compressed into
50 KiB. They are not held-out generalization results.

## Final recipe

Run:

```bash
cd improved-decoder
npm run train
npm run compile
npm run evaluate -- --scope=corpus --limit=0
```

Training scans every evaluation island in all 11,385 corpus sentences and
builds two tables.

### Global V7-code phrase priors

For each complete island code, training counts target phrases and retains up to
three phrases. Records are globally ordered by occurrence count, and the first
1,200 are emitted. A retained phrase receives:

```text
min(6, max(0.25, log2(count + 1)))
```

as an additive bonus to its KenLM log score. The generated file stores this in
quarter units to save bytes.

This table supplies broad lexical knowledge. It is especially useful when a
V7 code has a common realization that KenLM slightly underrates.

### Previous-word-conditioned exceptions

Training also counts:

```text
(previous normalized word, complete V7 island code) -> target phrase
```

For each context key it retains the most frequent target and computes the
advantage over the runner-up. Context records whose winner is already the
global winner for the code are discarded; they would duplicate the global
table. The remaining records are ordered by:

1. descending winner-minus-runner-up advantage;
2. descending winner count; and
3. deterministic lexical key order.

The first 665 exceptions are emitted. A match receives a fixed `+12` bonus,
which effectively selects the corpus-supported contextual exception while
still using the same complete-candidate generator.

### Runtime policy

The decoder:

1. enumerates every legal complete phrase for the at-most-two-syllable island;
2. computes each candidate’s KenLM score once;
3. adds its global and contextual bonuses;
4. sorts by the cached total, with a deterministic lexical tie-break; and
5. returns the best five legal complete candidates.

The current artifact is 50,070 bytes. Module initialization builds lookup
objects once; per-request sorting does not repeatedly join strings or repeat
table and KenLM lookups.

## Quantitative experiment log

All 500-sentence rows use the same first 500 corpus sentences and the same
KenLM-only reference score of 5,147. Lower inconvenience is better.

| Experiment                                | Artifact bytes | Decoder score | Result                                 |
| ----------------------------------------- | -------------: | ------------: | -------------------------------------- |
| 1,200 global records                      |         32,507 |         5,112 | First reliable improvement             |
| 1,800 global records                      |         48,651 |         5,087 | More broad records helped              |
| 1,200 global + 600 contextual             |         50,199 |         5,077 | Context beat more global rows          |
| 1,100 global + 700 contextual             |         50,557 |         5,081 | Rejected: too much broad coverage lost |
| 1,200 global + 665 contextual, compressed |         50,116 |         5,075 | Best table allocation                  |
| Same policy, score each candidate once    |         50,070 |         5,075 | Same ranking, faster and smaller       |
| Stronger global weight (`/3`)             |         50,116 |         5,081 | Rejected                               |
| Weaker global weight (`/5`)               |         50,116 |         5,083 | Rejected                               |

The initial 100-sentence checkpoint improved 875 to 868 with only 1,200 global
records. After context synthesis and the final allocation, the same slice
scores 864.

The first complete-corpus contextual artifact, with 600 exceptions, improved
101,249 to 100,083. The final 665-exception policy improves it further:

| Metric                     | KenLM-only reference | Synthesized policy |
| -------------------------- | -------------------: | -----------------: |
| Inconvenience              |              101,249 |        **100,027** |
| Inconvenience per syllable |             0.592387 |       **0.585237** |
| Top-1 exact                |               89.82% |         **91.08%** |
| Target in top five         |               98.88% |         **98.93%** |
| Illegal output             |                    0 |                  0 |

This saves 1,222 modeled actions across 90,497 islands and 170,917
representable syllables. The unavoidable entry cost is one action per island,
so the baseline has 10,752 actions above that floor. The synthesized policy
removes 11.37% of that reducible inconvenience.

Machine-readable measurements are in `results/`.

## What worked

### Complete-candidate synthesis exposed search headroom

The artifact constructs complete candidates; it does not merely rerank the
production beam’s output. Exhaustive composition makes the legal lattice a
high-recall oracle and prevents early pruning from hiding phrases that become
strong only after the second syllable.

The Cartesian product is tractable here only because an evaluation island has
at most two syllables. Work across the corpus is:

```text
sum over islands of (candidates in slot 1 * candidates in slot 2)
```

It is not one product across the whole corpus. The work is additive over 90,497
small islands, but still exponential in island length. This makes exhaustive
search useful for discovering headroom and unsuitable as the general
production strategy.

### Context records were more valuable than the same space in global records

Expanding 1,200 global rows to 1,800 saved 25 more actions on the 500-sentence
slice. Reallocating 600 rows to previous-word-conditioned exceptions saved
another 10. The nearby 1,100-global/700-context allocation regressed by four,
showing that both broad coverage and specific exceptions matter.

The useful selection rule was not “memorize every context.” It was:

- omit a context when it agrees with the global winner;
- favor a decisive contextual winner over an ambiguous one; and
- keep global frequency as the fallback.

### Small data-format changes bought meaningful model capacity

Every contextual record originally repeated the same encoded `48` bonus.
Splitting global and contextual data into separate strings moved the constant
into decoder logic. The recovered bytes increased contextual records from 600
to 665 while shrinking the final compiled artifact.

Under a hard size limit, repeated delimiters, constants, field names, and
parsing branches are part of the optimization objective. Source size is not
the authority: only the final bundled artifact size counts.

### Scoring once per candidate fixed the latency hotspot

The first synthesized comparator recomputed:

- `sequence.join(" ")`;
- the KenLM score-map lookup;
- global-prior lookup; and
- contextual lookup

on every sort comparison. Hoisting these values into one candidate record
preserved ranking, shrank the bundle by 46 bytes, and passed the 50 ms
sandboxed-call gate on all 4,751 islands in the 500-sentence slice.

The deliberately naïve reference timed out after 1,829 islands under the same
gate. This does not make exhaustive search suitable for production; it shows
that algorithmic constants and repeated comparator work matter even when two
policies inspect the same lattice.

### The original prior strength was a genuine local optimum

The global bonus is approximately `log2(count + 1)`. Increasing it by changing
the runtime divisor from 4 to 3 regressed the 500-sentence score from 5,075 to
5,081. Weakening it with divisor 5 regressed to 5,083. The experiment retained
divisor 4 rather than assuming a corpus-fit objective always benefits from a
stronger memorization weight.

### Efficient evaluation was essential for agent-guided iteration

Several host improvements cut iteration time without changing scores:

- Baseline and synthesized policies now share one set of KenLM results. The
  100-sentence comparison fell from about 41 seconds to 21 seconds.
- A word 3-gram needs only the final two prefix words as continuation state.
  Trimming repeated full-sentence prefixes reduced the 500-sentence pass from
  about 145 seconds to 74 seconds.
- The final full-corpus shared pass took about 23 minutes instead of roughly
  twice that.
- Progress is reported every 250 sentences so a long synthesis run is
  observable.

Caching or sharing evaluator work is not a decoder accuracy trick. It is what
makes enough CPU-only experiments possible to discover accuracy improvements.

## Agent-guided search lessons

### Use a ladder of increasingly expensive evaluations

The first 100 sentences were fast but unusually easy: the reference reached
91.52% Top-1 there, compared with 89.82% on the complete corpus. That slice was
useful for plumbing checks, legality, and rejecting catastrophic policies, but
too optimistic for selecting close variants.

The effective evaluation ladder was:

1. compile and enforce the byte limit;
2. run one sentence to verify the KenLM protocol and legality;
3. run 100 sentences for fast regressions;
4. use a fixed 500-sentence slice for nearby policy and allocation choices; and
5. run all 11,385 sentences only after a candidate wins the cheaper gates.

Improvements on the 500-sentence slice transferred in direction to the complete
corpus, but the full pass was still required to establish magnitude.

### Change one important variable at a time

The most interpretable iterations changed table allocation, context logic,
data encoding, prior strength, or comparator work separately. This made it
possible to say why 1,100/700 lost to 1,200/665 and why divisor 4 beat both
neighboring weights.

Large agent-written rewrites should be reserved for new hypotheses. Numeric
neighbors, record budgets, and serialization layouts can be explored
deterministically without spending another LLM proposal. The agent is most
valuable for diagnosing a failure pattern and proposing a new representation
or algorithm.

### Preserve losing configurations

Only winners belong in the generated artifact, but losing scores belong in the
training record. Without the `/3`, `/5`, and 1,100/700 results, later work could
repeat the same experiments or incorrectly conclude that more context and
stronger corpus weighting are always better.

Every measured result should bind:

- source/artifact hash;
- corpus and evaluator version;
- exact training arguments;
- compiled byte count;
- legality and timeout status; and
- score, latency, and evaluation scope.

The JSON files in `results/` are an initial record, not yet a complete
experiment database.

### Relative feedback is enough for selection, not diagnosis

This run had local numeric scores, but the same hill-climbing structure can use
a private comparison oracle: submit a candidate hash and learn only whether it
beats the current champion. Batch changes into fixed windows, such as the
proposed five-minute cadence, and publish a numeric score only for a new
champion.

Relative feedback can select between `/3`, `/4`, and `/5`, but it cannot explain
why one wins. Keep detailed targets and counterexamples on the public training
corpus, use restricted comparisons only for adaptive validation, and never
query a sealed final test during synthesis. The corpus-fit experiment is a
separate mode in which all targets are intentionally available; it must remain
clearly labeled so its score is not mistaken for hidden-test performance.

### Commit reproducible checkpoints, not every speculative mutation

The useful checkpoints were the first working host, first scored improvement,
expanded global table, contextual policy, full-corpus result, compressed table,
and timeout-enforced policy. Each was regenerated, compiled, measured, and then
committed. Speculative variants that lost were regenerated away but documented.

This produces a bisectable history without treating the main branch as a raw
experiment log.

## Infrastructure lessons

### KenLM’s query protocol is stream-oriented but not line-oriented

The Dockerized KenLM `query -v word` process writes scores to standard output,
but each response ends in a tab rather than a newline. A `readline` parser
therefore deadlocked until standard input closed. `stdbuf -oL` could not fix a
missing delimiter.

The working host parser:

- keeps one persistent KenLM process;
- consumes arbitrary stdout chunks;
- splits completed fields at tabs;
- knows the expected field count from prefix length, continuation length, and
  the final end-of-sentence token; and
- resolves queued requests in submission order.

When adapting command-line research tools as long-running oracles, inspect
their exact bytes instead of assuming that human-readable terminal output is a
newline-framed protocol.

### A promise is not enough to keep Node alive

The original evaluator appeared to exit successfully without printing JSON.
Its scoring promises were waiting for newline-delimited responses, while the
KenLM child eventually stopped being a useful active handle. Pending promises
alone do not guarantee that Node remains alive. The apparent silent exit was a
protocol/liveness bug, not a decoder result.

### Time the exported program, not only module loading

The first VM setup applied a timeout only while evaluating the bundle. Once the
exported decoder was returned to the host, calls were unbounded. The host now
invokes the decoder through an interruptible VM script and records `TIMEOUT`
separately from `ILLEGAL`.

A per-call VM deadline still is not an end-to-end product latency measurement:
the research host prepares enumeration and KenLM scores before the timed
artifact call. Production qualification must include parsing, enumeration,
KenLM, validation, rendering, cold start, memory, and low-end devices.

### Failures must not contaminate the other comparison arm

Initially, one decoder timeout aborted the entire paired evaluation. The host
now stops scoring the failed policy, records `TIMEOUT`, and continues the other
policy with the shared oracle. This produced the useful result that the naïve
reference timed out while the optimized synthesized policy completed the
500-sentence slice.

Legality and timeout are feasibility constraints, not large numeric penalties.
A policy that violates either must never look competitive because of how the
scalar score is aggregated.

## What the scores do not prove

### The reference is not the production Rust beam

`src/baseline.js` is an exhaustive KenLM-only reference policy. It isolates
ranking changes on a full legal candidate set. It does not reproduce the
repository’s actual beam search, so the measured score difference is not yet a
direct production-baseline comparison.

The next search study should score and time:

1. the production Rust beam;
2. exhaustive Cartesian KenLM;
3. the current corpus-fit exhaustive policy; and
4. bounded synthesized beams, best-first search, or branch-and-bound variants.

That comparison separates candidate-pruning gains from corpus-prior gains.

### The local inconvenience evaluator is optimistic

Every island receives the ground-truth preceding text. A wrong prediction does
not become context for the next island, and the model assumes the user detects
and corrects every error immediately. Candidate ranks 2 through 5 all cost one
action. It does not model delayed discovery, cursor travel, undo, deletion,
retyping, inspection time, or error cascades.

The complete discussion is in `../PROGRAM_SYNTHESIS_REPORT.md`. The new
`../evaluator/evaluateImeSession.ts` implements the stateful sensitivity curve
described there; see `../evaluator/SESSION_EVALUATOR.md`. This score should
still be described as local oracle-history inconvenience, not actual IME
effort.

### Corpus-fit accuracy is not generalization

The final artifact was selected using the same corpus on which it is reported.
This is intentional for the Kolmogorov/compression experiment, but it can
memorize repeated constructions. If the product goal changes to unseen text,
freeze this artifact and introduce document-level train, adaptive-validation,
and sealed-test partitions. Do not tune against the sealed test.

### The 50 ms result is a partial latency gate

The synthesized program passed a 50 ms artifact-call cap on the first 500
sentences. It has not been qualified end-to-end on phones, and the full corpus
was scored before this gate was added. The optimized comparator is
ranking-equivalent, so the accuracy totals remain valid, but interactive
shipping requires the device and session tests described in the report.

## Recommended next iteration

1. Measure the real Rust decoder on both the local and causal evaluators, then
   calibrate action-time weights on the target-device matrix.
2. Add recorded-stroke trace ingestion and compare undo-and-retype recovery
   with the deterministic piecemeal/editor policy.
3. Use exhaustive search only to label pruning failures and establish an oracle
   upper bound.
4. Distill the winning priors and exceptions into an adaptive-width beam,
   best-first search, or branch-and-bound generator with explicit expansion and
   KenLM-call budgets.
5. Enforce both deterministic work limits and end-to-end p95/p99 deadlines on a
   low-end device matrix. Retain `TIMEOUT` and `ILLEGAL` as hard failures.
6. Add error-directed synthesis: spend bytes on recurring cases where the
   bounded baseline misses and the full lattice contains the target, rather
   than only on globally frequent records.
7. Preserve privacy: use public corpus statistics and explicit user dictionary
   strokes, not hidden personalization or private typing-history collection.
8. If unseen-text performance matters, introduce sealed document-level splits
   and report corpus-fit and generalization scores separately.

The main lesson is that agent-driven program synthesis can find a meaningful
win under severe CPU and artifact constraints, but only when the evaluator,
oracle plumbing, artifact compression, legality checks, and latency gates are
treated as part of the synthesized system. The 1,222-action corpus-fit gain is
real under the current metric; translating it into a shippable IME improvement
now depends more on causal evaluation and bounded search than on adding another
small heuristic.
