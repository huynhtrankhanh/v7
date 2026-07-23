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

## Current checkpoint

Run:

```bash
cd improved-decoder
npm run compile
```

Evaluation and measured baseline/improved scores will be added after the
KenLM-backed host and deterministic corpus split are implemented.
