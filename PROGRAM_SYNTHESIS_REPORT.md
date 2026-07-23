# Evaluator-Guided Program Synthesis for V7 Decoding

## Decision

V7 is a good candidate for **offline LLM-guided program synthesis of an
entire constrained decoder**. The program should generate its own full list of
V7 candidates; it is not limited to reranking the current beam-search output.

The production program must nevertheless remain a constrained decoder: every
candidate must round-trip exactly to the V7 island typed by the user. The
evaluator now returns `ILLEGAL` if inference emits a non-round-trippable
candidate. That rule is both a safety condition for synthesis and a guard
against accidentally improving the interaction metric with impossible output.

This is feasible, but it is an empirical research project rather than a
credible promise of a particular accuracy gain. Program search can find a
better policy for using available information. It cannot infer an ambiguity
that is absent from the V7 input, the left context, user history, and its
language-model queries.

## Operating constraint: CPU-only, no model training

This proposal requires **no GPU, local LLM, fine-tuning, or learned reranker**.
The only AI component is a coding agent which proposes JavaScript changes. The
fixed coding agent is outside the runtime path; all candidate execution,
KenLM queries, correctness checks, and fitness evaluation run on CPU. The
winning decoder is ordinary sandboxed JavaScript and makes no model/API call in
production.

This is the original FunSearch pattern rather than model training: a pretrained
LLM supplies proposals while the evaluator, not the LLM, decides whether they
are retained. AlphaEvolve likewise describes LLMs making code changes under
automated evaluation. This makes the approach a practical fit for a restricted
compute budget, provided LLM calls are treated as scarce and high-value.

The search should therefore maximize **improvement per agent call**:

- begin with four to eight manually diverse, correct decoder seeds instead of
  asking the agent to write a decoder from scratch;
- use local, deterministic mutations (numeric threshold changes, operator
  swaps, beam-width schedules) between agent calls;
- reserve agent calls for semantic changes to search strategy and data
  structures;
- evaluate cheaply in stages, stopping immediately on illegality, timeout, or
  a bad small training shard;
- return one concrete train-only counterexample and a small error-cluster
  summary rather than a bare scalar score; and
- ask for compact patches to a stable interface, rather than repeatedly
  generating a complete program.

This counterexample-guided form is supported by recent work on
[property-guided LLM program synthesis](https://arxiv.org/abs/2605.16142),
which reports markedly fewer generated programs than scalar-score-only search
when a verifier can give a failing example. V7 has unusually cheap verifiable
properties: output parses, every syllable round-trips, no duplicate candidates,
the list is bounded, and resource limits hold.

## Existing fit

The repository already contains the three required building blocks:

1. `inference-rs/src/main.rs` parses V7 input and enumerates legal Vietnamese
   syllables for every encoded slot.
2. It exposes a fast KenLM word 3-gram score while decoding.
3. `evaluator/evaluateInference.ts` measures the actual interaction objective:
   V7 entry, visible-candidate selection, piecemeal entry, and syllable
   replacement.

The standard decoder is one hand-written point in a much larger program space:
a fixed-width constrained beam search using KenLM as its score. A synthesized
program can choose its own candidate-generation and search policy, including
dynamic programming, A*, diverse beams, best-first search, adaptive beam
widths, phrase caching, and user-history logic.

## Proposed sandboxed interface

The synthesized JavaScript is a pure function:

```ts
function infer(
  request: { fixedLeftText: string; v7Island: string; maxCandidates: number },
  api: V7Api,
): string[];
```

`V7Api` should expose the legal action space and efficient 3-gram scoring:

```ts
type V7Api = {
  parse(v7Island: string): readonly Slot[];
  enumerate(slot: Slot): readonly string[];
  matches(slot: Slot, syllable: string): boolean;
  kenlmBegin(leftText: string): KenLmState;
  kenlmStep(state: KenLmState, word: string): [KenLmState, number];
  vocabularyRank(word: string): number | null;
  userRecency?(wordOrPhrase: string): number;
};
```

`enumerate` is essential. KenLM scores an offered word but cannot enumerate
the finite set of words compatible with a code such as `tro2`. Exposing legal
syllables does not make the program a reranker: it still constructs and
returns complete multi-syllable candidates, and can avoid the existing beam
policy altogether.

The host validates every output with the same V7 reverse mapping used by the
evaluator. It also caps candidate count, execution time, memory, API calls,
recursion, source size, and literal-table size. The sandbox must deny network,
filesystem, environment, wall clock, randomness, imports, `eval`, and mutable
global state. Programs must be deterministic under a fixed seed.

## What may improve

The highest-probability improvements are policy improvements rather than new
linguistic knowledge:

- retain competing paths at highly ambiguous slots while spending little extra
  work on unambiguous ones;
- jointly search two-syllable islands rather than pruning each slot too early;
- optimize the visible top five, where rank 2--5 costs one user action but a
  missing answer can require piecemeal editing;
- use phrase frequency, candidate diversity, candidate-score margins, and
  local recency in addition to raw 3-gram score;
- specialize fallback behavior for proper nouns, rare words, code-switching,
  and unknown words; and
- discover compact conditional policies for recurring V7 ambiguity classes.

The initial diagnostic must be **oracle headroom**. For every target, record
whether it is (a) absent from the legal syllable lattice, (b) in the lattice
but pruned by a broad reference search, (c) in the full beam but outside the
visible five, or (d) visible but poorly ordered. Synthesis can address (b)--(d)
but not missing legal candidates.

## Search and evaluation protocol

Use three strictly different data roles:

| Dataset             | What the synthesizer can see                     | Use                                    |
| ------------------- | ------------------------------------------------ | -------------------------------------- |
| Train               | Targets and detailed evaluator traces            | Diagnose failures and propose programs |
| Adaptive validation | No targets; restricted aggregate oracle feedback | Retain promising programs              |
| Sealed test         | No data or feedback until programs are frozen    | Final generalization estimate          |

Split by document/source and domain rather than by random sentence. Otherwise
repeated templates and adjacent text leak into validation. Keep named entities,
conversational text, technical text, news, literary text, and a temporally
later corpus as explicit test slices.

The adaptive-validation set cannot be called a test set after the LLM sees
hundreds of scores. Repeated program mutation is adaptive hyperparameter/model
selection and can overfit aggregate scores. Return only rounded aggregate
metrics, rate-limit submissions, report a new best only after a meaningful
paired-bootstrap margin, and avoid returning per-example feedback. Multiple
hidden validation shards and a Pareto archive further reduce brittle search.

### Private relative-score oracle

For the CPU-only agent loop, use a **server-held private leaderboard** rather
than giving the agent numeric validation scores. Each evaluated program gets an
opaque, authenticated receipt token. The evaluator stores the real metrics;
the token is only a handle for that record.

```text
submit(program) -> encrypted receipt token
                  -> server evaluates private validation
                  -> server compares program with incumbent
                  -> {accepted: true|false, receipt}

every five minutes -> reveal only the current champion's rounded score
```

The comparison is relative and performed inside the evaluator. "Accepted"
means the program passes all hard gates and beats the incumbent under a fixed
lexicographic policy: legality first, then lower inconvenience, then no
regression in top-five recall, latency, and complexity. The agent never learns
the submitted program's numeric score, individual metrics, per-example
results, margin, or validation examples.

Implement the receipt as an AEAD-encrypted or HMAC-signed, unguessable record
identifier bound to the run, program hash, evaluator version, and submission
window. Keep the raw score and decryption/signing key solely in the trusted
evaluator. A database record is simpler and safer than attempting client-side
comparison of encrypted score values.

Do **not** use order-preserving/order-revealing encryption merely so the agent
can compare tokens locally. Such schemes deliberately reveal ordering and can
leak additional distribution information; [EncodeORE](https://eprints.ncl.ac.uk/269179)
and [Multi-Client ORE](https://arxiv.org/abs/1809.01320) make that leakage
model explicit. It is unnecessary here: the trusted evaluator already knows
the score and can return the single comparison bit needed for evolutionary
selection.

Five-minute champion publication is useful but insufficient on its own. Batch
all submissions in a window, allow at most one agent submission per window,
compare them server-side, and reveal the numeric best score only if a champion
changes by a predeclared material threshold. Otherwise reveal only a signed
"no material improvement" event. This gives the agent a sparse evolutionary
signal while limiting feedback bits, consistent with leaderboard work such as
[The Ladder](https://arxiv.org/abs/1502.04585) and its
[bootstrapped-score extension](https://arxiv.org/abs/1607.00091). It still
does not turn adaptive validation into a sealed test; keep the final test
entirely query-free.

The sealed test should be run once for a frozen shortlist and report:

- mean inconvenience per representable syllable (primary);
- Top-1 exactness and target-in-top-five recall;
- full-lattice oracle recall;
- candidate legality and timeout rates;
- p50/p95 latency and memory; and
- per-domain and rare-word results.

No result should be promoted if it reduces interaction cost by making valid
candidates unavailable, by exceeding the latency budget, or only on the
adaptive-validation oracle.

## Search loop

Seed a population with the current decoder plus deliberately different,
correct implementations: exhaustive dynamic programming, a diverse beam, an
adaptive-width beam, and a best-first/A* decoder. Prompt the LLM with
train-only failure clusters, aggregate metrics, and a diverse selection of
existing programs. Require it to state an algorithmic hypothesis before it
emits a replacement function.

For every proposal:

1. Parse and execute in the sandbox.
2. Enforce round-trip V7 validity and resource limits.
3. Evaluate on train for diagnostic traces.
4. Query restricted validation only for candidates that pass fixed gates.
5. Add nondominated candidates to a Pareto archive over inconvenience,
   accuracy, latency, and program complexity.
6. Freeze selected programs before the sealed test.

Use a CPU-efficient evaluator cascade. On every candidate, first run parsing,
round-trip legality, determinism, and microbenchmarks; then a fixed small
training shard; then the full training set; and only then query adaptive
validation. Cache results by source hash and cache KenLM scores/states within
an evaluation. This is important because the evaluator will be invoked many
more times than the coding agent, and no GPU is available to compensate for an
inefficient search.

Compare this against non-LLM search: manual beam ablations, random/Bayesian
parameter optimization, and ordinary genetic programming. Also compare a
small learned Vietnamese scorer plus the synthesized decoder: program search
can use a 3-gram more effectively, whereas a learned scorer supplies genuinely
new contextual information.

## Relevant literature

- [FunSearch](https://doi.org/10.1038/s41586-023-06924-6) demonstrates the
  core model: an LLM proposes executable functions and an automated evaluator
  evolves the best programs.
- [AlphaEvolve](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/)
  applies evaluator-guided LLM evolution to larger algorithmic systems.
- [OPRO](https://arxiv.org/abs/2309.03409) is a direct baseline for iteratively
  proposing solutions from earlier scored solutions.
- [EPiC](https://arxiv.org/abs/2408.11198) is evidence for minimizing LLM
  interactions with a lightweight evolutionary outer loop; it is about prompt
  engineering rather than V7 decoder synthesis, so it informs budget design,
  not expected V7 accuracy.
- [RankEvolve](https://arxiv.org/abs/2602.16932) is recent preprint evidence
  that LLM-guided program evolution can discover retrieval algorithms that
  transfer across benchmarks; it is encouraging but not proof for V7.
- [Grammar-Constrained Decoding](https://aclanthology.org/2023.emnlp-main.674/)
  and [Constrained Beam Search](https://aclanthology.org/D17-1098.pdf) support
  enforcing a formal output space during generation rather than checking an
  unconstrained answer afterward.
- [Generalization in Adaptive Data Analysis and Holdout Reuse](https://proceedings.neurips.cc/paper/2015/hash/bad5f33780c42f2588878a9d07405083-Abstract.html),
  [The Ladder](https://arxiv.org/abs/1502.04585), and
  [Overtuning in Hyperparameter Optimization](https://proceedings.mlr.press/v293/schneider25a.html)
  explain why repeatedly optimizing a held-out score needs special controls.

## Conclusion

An evaluator-guided LLM program-synthesis system can synthesize the **entire
V7 decoder** under a JavaScript sandbox with KenLM access. The defensible
research claim to pursue is: _a generated constrained decoding policy reduces
sealed-test interaction cost at a fixed resource budget_. The necessary
discipline is as important as the generator: hard V7 validity, a deliberately
limited adaptive oracle, and a truly untouched final test.
