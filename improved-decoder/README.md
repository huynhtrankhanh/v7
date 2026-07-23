# Improved decoder synthesis experiment

This folder measures whether a coding agent can synthesize a complete V7
candidate generator as a JavaScript artifact no larger than 50 KiB.

The artifact:

- receives the V7 island and fixed left context;
- enumerates legal syllables through a frozen host API;
- queries contextual KenLM continuation scores through the host;
- constructs and returns up to five complete candidates itself; and
- has no filesystem, network, corpus, user-history, or existing-beam-search
  access at runtime.

`src/baseline.js` is the exhaustive KenLM-only reference policy.
`src/decoder.js` is the trainable/synthesizable policy. `scripts/compile.mjs`
bundles and minifies both to `dist/` and rejects artifacts over 51,200 bytes.

The current experiment is deliberately **corpus-fit**, not held-out: synthesis
may inspect all of `evaluator/dataset.json`, and scoring uses that same complete
corpus. This measures how much useful corpus structure can be compressed into
50 KiB. It does not estimate generalization to unseen writing.

## Current checkpoint

Run:

```bash
cd improved-decoder
npm run train
npm run compile
npm run evaluate -- --scope=corpus --limit=0
```

The current compressed artifact combines 1,200 global phrase priors with 665
previous-word-conditioned exceptions in 50,070 bytes. Its complete-corpus
result is:

| decoder            |  bytes | inconvenience | per syllable |      top-1 |      top-5 |
| ------------------ | -----: | ------------: | -----------: | ---------: | ---------: |
| KenLM baseline     |    745 |       101,249 |     0.592387 |     89.82% |     98.88% |
| synthesized policy | 50,070 |   **100,027** | **0.585237** | **91.08%** | **98.93%** |

This saves 1,222 modeled user actions on 170,917 representable syllables. Put
another way, it removes 11.37% of the baseline's inconvenience above the
unavoidable one-entry-per-island cost. Machine-readable records are in
`results/`; baseline and synthesized policies share one oracle pass.

## Interactive program-call gate

The host interrupts each sandboxed decoder invocation after 50 ms. On the first
500 corpus sentences, the optimized synthesized decoder completes all 4,751
islands and retains its 5,075 score. The deliberately naïve exhaustive baseline
times out after 1,829 islands because its sort comparator repeatedly recomputes
candidate values.

This gate covers artifact execution after candidates and KenLM scores have been
prepared. It does **not** establish production latency: end-to-end parsing,
enumeration, KenLM work, validation, rendering, and device behavior must be
measured separately. See `results/corpus-500-interactive.json` and the latency
section in `PROGRAM_SYNTHESIS_REPORT.md`.
