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
npm run evaluate -- --scope=corpus --limit=100
```

The first 100 corpus sentences produce:

| decoder            |  bytes | inconvenience | per syllable |      top-1 |  top-5 |
| ------------------ | -----: | ------------: | -----------: | ---------: | -----: |
| KenLM baseline     |    745 |           875 |     0.578321 |     91.52% | 99.63% |
| synthesized priors | 32,507 |       **868** | **0.573695** | **92.39%** | 99.63% |

The machine-readable record is in `results/corpus-100.json`. The full-corpus
score remains to be measured after eliminating duplicate oracle work between
the two decoders.
