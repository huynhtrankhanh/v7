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
that is absent from the V7 input, left context, public training corpus, and
language-model queries.

## Privacy scope

The synthesized decoder is deliberately **non-personalized**. It must not
collect, retain, or learn from a user's typing history, profile, or private
documents. Its only linguistic data is a public, versioned training corpus.
The existing explicit dictionary remains the privacy-preserving mechanism for
names, specialist vocabulary, and user-specific phrases: users can define a
stroke rather than relying on hidden behavioral adaptation.

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
widths, phrase caching, and public-corpus-derived grammar rules.

### Measured ambiguity in the bundled evaluation corpus

The corpus supports the premise that contextual reconstruction is worthwhile.
Using `evaluator/getInference.ts` to encode every Unicode-letter word in
`evaluator/dataset.json` produced the following descriptive statistics:

| Measure                                     |            Value |
| ------------------------------------------- | ---------------: |
| Sentences                                   |           11,385 |
| Word tokens                                 |          171,422 |
| V7-representable tokens                     | 170,924 (99.71%) |
| Observed V7 codes                           |              793 |
| Observed syllables                          |            3,027 |
| Codes with more than one observed syllable  |      621 (78.3%) |
| Mean observed syllables per code            |             3.82 |
| Largest observed ambiguity class            |     15 syllables |
| Code-only empirical Top-1 accuracy          |            65.1% |
| Conditional lexical entropy given a V7 code |  1.35 bits/token |

The code-only Top-1 number selects the most frequent syllable for each code on
the same corpus, so it is **not** an accuracy estimate for a deployable model.
It is evidence of the problem's ambiguity: 95.0% of represented tokens use a
code that has more than one observed syllable. Context and search policy have
substantial headroom to matter.

It does not establish that grammar is the missing signal. A grammatical rule
cannot distinguish two syntactically valid alternatives, and a 3-gram may
already capture common short patterns. The report therefore treats grammar as
one candidate feature family, to be tested against simpler search and
phrase-frequency improvements rather than assumed to win.

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
  public-corpus-derived grammatical structure in addition to raw 3-gram score;
- specialize fallback behavior for proper nouns, rare words, code-switching,
  and unknown words; and
- discover compact conditional policies for recurring V7 ambiguity classes.

The initial diagnostic must be **oracle headroom**. For every target, record
whether it is (a) absent from the legal syllable lattice, (b) in the lattice
but pruned by a broad reference search, (c) in the full beam but outside the
visible five, or (d) visible but poorly ordered. Synthesis can address (b)--(d)
but not missing legal candidates.

### Feasibility gates before a large search

Do not commit a large agent budget until three CPU-only measurements pass:

1. **Reference-beam recall:** Run a deliberately broad, legal reference search
   and measure target-in-lattice and target-in-beam recall. Low recall means
   improve enumeration/search before grammatical rules.
2. **Failure taxonomy:** Independently label a random sample of baseline
   failures as missing candidate, pruning, phrase/grammar, lexical-semantic,
   or rare-term failures. Grammar synthesis is only justified when
   phrase/grammar and pruning form a material share.
3. **Non-agent ablation:** Compare adaptive beam width, phrase counts, and
   simple public-corpus rules with the fixed beam. If these cannot improve
   sealed inconvenience, an agent is unlikely to create an easy win from the
   same information.

The first useful success criterion is modest and concrete: reduce sealed-test
mean inconvenience at a fixed p95 latency while preserving legal output and
target-in-top-five recall. Do not pre-commit to a large Top-1 gain. A lower
correction cost from better top-five ordering is already a product improvement.

## The current evaluator is not a realistic typing-session model

`evaluator/evaluateInference.ts` is useful for controlled local comparisons,
but its inconvenience score should not be presented as an end-to-end estimate
of actual IME effort. It divides finished prose into independent V7 islands of
at most two syllables and requests every prediction with:

```ts
[targetText.slice(0, island.sourceStart), island.v7Code, ""];
```

That prefix is the ground-truth text, not text the decoder actually committed.
After scoring one island, the evaluator moves to the next target island without
carrying the prediction or simulated correction state forward. It therefore
assumes that every ambiguity is noticed and resolved immediately.

This creates several optimistic simplifications:

- A wrong prediction never becomes KenLM context for the next prediction.
  Real errors can compound: one accepted homophone changes later rankings and
  can start a cascade.
- The user never overlooks a plausible wrong word. In practice, detection may
  occur several islands later, at punctuation, after rereading a clause, or not
  at all before sending.
- Every visible non-first candidate costs one action. Candidate 2 and candidate
  5 are treated alike, with no scanning, navigation, or decision-time cost.
- Piecemeal correction begins at the erroneous island immediately. There is no
  cursor travel, selection, deletion of intervening text, undo, re-entry, or
  reconstruction of a longer corrupted span.
- The evaluator starts from completed target prose instead of replaying
  incremental strokes, composition updates, candidate changes, commits, and
  timing.
- Independent two-syllable decisions cannot model maintaining ambiguity across
  a longer phrase and resolving it using later evidence.

As a result, the current score measures **local oracle-history ranking and
immediate correction cost**. It is still valuable for legality tests, candidate
lattice diagnostics, and fast synthesis iterations, but an improvement in this
score is evidence of decoder headroom rather than a direct prediction of user
experience.

### Replace it with stateful causal replay

A realistic primary evaluator should replay complete sessions through the same
state transitions as the IME. Its state should include the actual committed
text, active composition, visible candidates and selected index, cursor or
selection, undo history, elapsed actions, and unresolved errors. The next
inference request must use the decoder's committed prefix, not the reference
prefix.

At minimum, implement three paired modes:

1. **Oracle-history local mode:** retain the current evaluator as a cheap,
   explainable diagnostic.
2. **Free-running causal mode:** automatically accept the top candidate and
   feed it into all later requests. Report final word/syllable error, error
   cascade length, and how much later ranking degrades after the first error.
3. **Delayed-correction user mode:** simulate when a user notices an error and
   replay the cheapest legal recovery through real IME operations. Use several
   predeclared detection policies--for example immediate, after 1/3/5 islands,
   at clause punctuation, and at end of message--rather than hiding one
   favorable assumption in a scalar.

The delayed-correction mode should charge action-specific costs for candidate
navigation by rank, commit, cursor movement, range selection, backspace/delete,
undo, retyping V7 chords, and reopening piecemeal mode. If time data is
available, add measured latency and candidate inspection time rather than
assuming all actions cost equally. A small user study or anonymized,
opt-in-only interaction study can calibrate detection-delay and action-time
distributions; personalization must remain unnecessary and disabled.

For deterministic research without user data, treat user behavior as a set of
scenarios and report the full sensitivity curve. A decoder should not be
declared better if it wins only under immediate correction but creates longer
cascades under delayed detection.

The session-level report should include:

- actions and estimated time per intended syllable;
- final uncorrected syllable/word error rate;
- probability that one error causes another;
- mean and p95 cascade length;
- distance and actions from error creation to recovery;
- candidate-navigation distance, not only top-five recall;
- undo, deletion, cursor-travel, and re-entry counts; and
- p50/p95 decoder latency during actual incremental replay.

Use paired target sessions and replay the baseline and synthesized decoder under
identical user policies. Keep the local inconvenience score as a decomposition:
when session performance changes, it helps distinguish better candidate
generation from merely different error propagation or recovery behavior.

### Enforce an interactive decoding deadline

Accuracy gains are not useful if candidate generation blocks typing. Treat
latency as a hard feasibility constraint and optimize inconvenience only among
programs that remain interactive.

Use two complementary limits:

1. A deterministic per-request work budget caps legal-candidate expansions,
   KenLM transitions, heap/beam operations, output candidates, and allocated
   bytes. This makes synthesis results comparable across machines and prevents
   a program from hiding unbounded work behind a fast development CPU.
2. A wall-clock deadline covers the complete hot path: parsing the new stroke,
   legal enumeration, KenLM scoring, synthesized search, validation, and
   rendering the candidate update. Measure this on representative low-end
   target phones, not only the development workstation.

Set the numeric deadline from product measurements rather than an arbitrary
desktop benchmark. First record the current decoder's warm p50/p95/p99 on the
target-device matrix while replaying realistic incremental sessions. Choose a
hard deadline that preserves the UI's frame/input-response budget, then require
new decoders to be no worse than the baseline at p95 and p99. Report cold-start
model-loading latency separately. A reasonable engineering starting gate can
be tested at 16, 25, and 50 ms per candidate update, but the shipped threshold
must be justified by device measurements and typing studies.

The evaluator must interrupt the **decoder invocation**, not only module
initialization. Run each call in an interruptible worker or VM execution with a
deadline; terminate and recreate the worker after timeout so no computation
continues in the background. Also enforce an aggregate session CPU budget to
catch programs that stay just below the per-call limit on every keystroke.
Timeouts are evaluation failures and must be reported explicitly, never
converted silently into a good inconvenience score.

Production should degrade safely: cancel obsolete work when a newer stroke
arrives, retain the last valid candidate list, and fall back to a small
known-good bounded decoder when the synthesized policy exceeds its budget.
Evaluation should score both the timeout and the fallback result so a program
cannot improve accuracy by routinely invoking the fallback. Cache immutable
KenLM states and reuse prefix work, but include cache misses and memory in the
device benchmark.

Exhaustive Cartesian enumeration is acceptable as a two-syllable research
oracle because it exposes pruning headroom. It should not be the production
latency target. Distill its discoveries into adaptive beams, best-first search,
branch-and-bound rules, or direct contextual exceptions with explicit expansion
caps, then compare their score against the exhaustive upper bound.

The prototype in `improved-decoder` now enforces a 50 ms sandboxed-program
deadline. On a 500-sentence corpus slice, its optimized synthesized policy
completed all 4,751 islands, while the intentionally naïve exhaustive reference
timed out after 1,829 islands. This is evidence that hoisting per-candidate work
out of the sort comparator matters, not proof of interactive production
latency: enumeration and KenLM scoring are prepared by the research host before
the timed call.

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
- [A Lexicalized Tree-Adjoining Grammar for Vietnamese](https://aclanthology.org/L06-1426/)
  establishes that Vietnamese admits a broad grammar usable for parsing and
  generation, supporting structural experimentation without claiming that a
  full grammar is required here.
- [VnCoreNLP](https://aclanthology.org/N18-5012/) demonstrates that CPU-friendly
  Vietnamese segmentation, POS tagging, and dependency parsing are practical.
  This project need not add such a dependency initially: the agent can first
  synthesize rules from public corpus counts. It is a possible offline source
  of structural annotations for later ablations, not a runtime requirement.
- [Explicit Syntactic Guidance for Neural Text Generation](https://aclanthology.org/2023.acl-long.788/)
  reports that structural beam search can improve generation and diversity,
  though it uses neural components and is evidence for the search principle,
  not a direct V7 result.
- [Dictionaries, Not Darwin](https://arxiv.org/abs/2607.04108) is an important
  recent negative result: on one equation-discovery setting, iterative
  parent-conditioned LLM evolution did not beat independent proposal sets at
  matched budgets. It argues for a diverse program-component library and
  external selection, rather than assuming evolution itself compounds gains.
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
