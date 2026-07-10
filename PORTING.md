# UI Core Porting Tracker

## Direction

The inference Web UI is moving DOM-neutral behavior into the Rust `v7-ui-core` crate and exposing coarse JSON/WASM APIs to JavaScript.

JavaScript remains responsible for browser and platform shells: DOM updates, event listeners, focus and clipboard behavior, CSS/layout, browser networking, and the future Android IME frontend. Rust should own reusable UI semantics that can be called from the web shell, Jest, and later Android-facing code.

Tests assume the Rust UI core is present. There is no TypeScript semantic fallback for provider-backed core APIs, because fallback behavior can drift from Rust.

## Completed Rust Ports

- Key mapping and stroke serialization.
- Web UI Vietnamese syllable stroke parsing, assembly, and valid-syllable generation.
- Two-syllable V7 stroke decoding.
- Emily symbol stroke decoding and shared Emily island typing.
- Retroactive spacing state transforms for Emily spacing commands.
- Keyboard display layout and browser key normalization.
- Keyboard stroke tracker lifecycle with state retained inside the Rust/WASM object.
- Candidate selection stroke matching.
- Visible text rendering.
- Visible text segment planning, including piecemeal markers, candidate diff sections, and inferred V7 display targets.
- Visible text grouping by candidate section.
- Coarse display planning for the DOM shell.
- Inference island conversion.
- Coarse inference request planning, including whether inference is needed and the exact request islands.
- Candidate text selection and selected-candidate island replacement.
- Piecemeal entry lookup, target discovery, replacement, and cursor advancement.
- Candidate diff planning using the structured 0-, 1-, or 2-region minimizer instead of whole-text LCS.

## Current JavaScript Boundary

- DOM rendering and view updates in `src/main.ts`.
- Browser input, focus, clipboard, and lifecycle handling.
- Network and inference request orchestration.
- Generated WASM bindings under `src/generated/`; these are required for local tests/builds but must stay untracked.

## Remaining DOM-Neutral Candidates

- Coarse app state transitions around stroke command handling, piecemeal mode, candidate selection, undo, and inference request policy.
- Practice/game logic where it is not browser-specific.
- Serialization contracts for Android-to-core calls once the IME shell shape is known.

## Build And Test Policy

- Build the Rust/WASM bindings before JS tests when Rust exports change: `npm run build:ui-core`.
- Run Rust and JavaScript tests before committing.
- Headless browser tests remain part of milestone validation when UI-facing behavior changes.
- Commit and push only after tests pass.
- Do not commit generated artifacts such as `src/generated/` or bundled browser output.
