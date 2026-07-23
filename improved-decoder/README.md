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

The current artifact combines 1,200 global phrase priors with 600
previous-word-conditioned exceptions. It uses 50,199 bytes. On all 11,385
corpus sentences it produces:

| decoder            |  bytes | inconvenience | per syllable |      top-1 |      top-5 |
| ------------------ | -----: | ------------: | -----------: | ---------: | ---------: |
| KenLM baseline     |    745 |       101,249 |     0.592387 |     89.82% |     98.88% |
| synthesized policy | 50,199 |   **100,083** | **0.585565** | **91.02%** | **98.93%** |

This saves 1,166 modeled user actions on 170,917 representable syllables. Put
another way, it removes 10.84% of the baseline's inconvenience above the
unavoidable one-entry-per-island cost. The machine-readable records are in
`results/`; baseline and synthesized policies share one oracle pass.
