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
npm run evaluate -- --scope=corpus --limit=500
```

The current 1,800-record artifact uses 48,651 bytes. On the first 500 corpus
sentences it produces:

| decoder            |  bytes | inconvenience | per syllable |      top-1 |      top-5 |
| ------------------ | -----: | ------------: | -----------: | ---------: | ---------: |
| KenLM baseline     |    745 |         5,147 |     0.569926 |     92.44% |     99.45% |
| synthesized priors | 48,651 |     **5,087** | **0.563282** | **93.60%** | **99.52%** |

This saves 60 modeled user actions on 9,031 representable syllables. The
machine-readable records are in `results/`. The full-corpus score remains to be
measured; baseline and synthesized policies now share one oracle pass.
