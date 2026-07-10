# Rust UI Core

This repository is migrating browser-independent UI logic into a Rust crate at
`v7-ui-core/`.

The Rust core owns browser-independent UI transforms behind coarse APIs:

- key mapping and stroke serialization
- fixed candidate-selection stroke matching
- visible text rendering and inference island conversion
- selected-candidate text/island replacement
- piecemeal syllable target discovery/replacement
- 0-, 1-, or 2-region candidate diff planning

These APIs keep heavy/token-oriented UI logic in a compact shared core that can
later be used by web, Android IME code, and native tooling.

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

The normal web production build requires this step:

```bash
npm run build
```

`npm run build` runs `scripts/build-ui-core-wasm.sh` first, then runs Vite.

Build generated web bindings with:

```bash
scripts/build-ui-core-wasm.sh
```

The script:

1. Builds `Dockerfile.ui-core`.
2. Runs `wasm-pack build` inside the container.
3. Writes browser bindings to `src/generated/v7_ui_core/`.
4. Writes Node/Jest bindings to `src/generated/v7_ui_core_node/`.
5. Restores host ownership on the generated files.

Equivalent Compose command:

```bash
docker compose run --rm ui-core-wasm
```

Generated files are local build artifacts and are intentionally not committed.
Regenerate them whenever `v7-ui-core/src/lib.rs` or its public WASM API changes.
Any web integration that imports `src/generated/v7_ui_core/`, or any Jest run
that imports `src/generated/v7_ui_core_node/`, must run this step first.

The generated directory is ignored by Git:

```text
src/generated/v7_ui_core/
src/generated/v7_ui_core_node/
```

## API Boundary

The WASM API currently uses JSON strings:

- `mapKeyUnique(key)`
- `serializeStrokeKeysJson(strokeKeysJson)`
- `getCandidateSelectionMatchJson(stroke, candidateCount)`
- `renderVisibleTextJson(islandsJson, candidatesJson)`
- `convertIslandsForInferenceJson(islandsJson)`
- `getSelectedCandidateTextJson(candidatesJson, index, islandsJson?)`
- `selectCandidateIslandsJson(candidatesJson, index, islandsJson?)`
- `getPiecemealEntryIndexJson(stroke)`
- `getNextPiecemealCursorIndexJson(currentIndex, nextTargetCount)`
- `findPiecemealSyllableTargetsJson(islandsJson, validSyllablesJson)`
- `replacePiecemealSyllableJson(islandsJson, targetJson, replacement)`
- `buildCandidateDiffPlanJson(islandsJson, candidatesJson, limit)`
- `buildCandidateTextDiffPlanJson(candidateTextsJson)`

This is deliberately coarse. JavaScript should not call tiny per-token helpers
across the WASM boundary. The Rust core owns the candidate-diff computation and
returns one complete plan.

`src/rustUiCore.ts` adapts the generated wasm-pack functions into
`src/uiCoreProvider.ts`. Provider-backed UI-core entry points require Rust; they
throw if called before the provider is initialized. Jest installs the same
provider from the generated Node WASM package in `tests/setupRustUiCore.ts`, so
web-core unit tests exercise Rust instead of a parallel TypeScript fallback.

## Semantic Parity

Existing TypeScript unit tests remain the semantic source for web behavior, but
their provider-backed calls now execute Rust through generated WASM. Native Rust
tests mirror the same web-core scenarios:

- key mapping and stroke serialization
- candidate-selection suffixes
- visible rendering and inference island conversion
- selected-candidate replacement
- piecemeal target discovery/replacement
- no visible candidate differences
- one changed diff region
- two separated changed diff regions
- adjacent changes collapsing to one region
- replacement-only V7 candidate shape
- full alternating candidate shape

When expanding the Rust core, preserve the public TypeScript result shapes until
the caller has been deliberately migrated.

Validation commands:

```bash
npm run test:unit -- --runInBand
npm run test:rust-ui-core
npm run test:keyboard-layout
```

`npm run test:keyboard-layout` is a Puppeteer test and runs the full Dockerized
web build before opening the production bundle.
