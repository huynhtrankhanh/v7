# Rust UI Core

This repository is migrating browser-independent UI logic into a Rust crate at
`v7-ui-core/`.

The first coarse API is candidate diff planning:

- input: text-buffer islands, inference candidates, visible candidate limit
- output: the same candidate diff plan shape used by the TypeScript web UI
- purpose: keep heavy/token-oriented UI logic in a compact shared core that can
  later be used by web, Android IME code, and native tooling

The DOM, keyboard view, event listeners, networking, and Android
`InputConnection` equivalents remain platform-shell concerns.

## Crate

`v7-ui-core` builds as both:

- a normal Rust library for native tests
- a `cdylib` WASM package for the web shell

Native validation:

```bash
cd v7-ui-core
cargo test
cargo fmt -- --check
```

## Dockerized WASM Build

The Rust/WASM toolchain is intentionally isolated in Docker because it is heavy.

Build generated web bindings with:

```bash
scripts/build-ui-core-wasm.sh
```

The script:

1. Builds `Dockerfile.ui-core`.
2. Runs `wasm-pack build` inside the container.
3. Writes generated bindings to `src/generated/v7_ui_core/`.
4. Restores host ownership on the generated files.

Equivalent Compose command:

```bash
docker compose run --rm ui-core-wasm
```

Generated files are local build artifacts and are intentionally not committed.
Regenerate them whenever `v7-ui-core/src/lib.rs` or its public WASM API changes.
Any web integration that imports `src/generated/v7_ui_core/` must run this step
first.

## API Boundary

The WASM API currently uses JSON strings:

- `buildCandidateDiffPlanJson(islandsJson, candidatesJson, limit)`
- `buildCandidateTextDiffPlanJson(candidateTextsJson)`

This is deliberately coarse. JavaScript should not call tiny per-token helpers
across the WASM boundary. The Rust core owns the candidate-diff computation and
returns one complete plan.

## Semantic Parity

Existing TypeScript unit tests remain the semantic source for web behavior.
Rust tests mirror the same candidate-diff scenarios:

- no visible differences
- one changed region
- two separated changed regions
- adjacent changes collapsing to one region
- replacement-only V7 candidate shape
- full alternating candidate shape

When expanding the Rust core, preserve the public TypeScript result shapes until
the caller has been deliberately migrated.
