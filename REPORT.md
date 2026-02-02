# Stripped Plover Integration Findings

## Summary
Stripped Plover is a headless, STDIO-based stenography translation engine that speaks a JSON line protocol. It is built for IME-style integrations (preedit + commit) and expects strokes in RTFCRE/Plover format. Because it targets Node.js (requires Node 22.5+ and built-in SQLite), it cannot run directly in the browser. The V7 web demo would need a backend bridge to run Stripped Plover as a sidecar process and relay translation results to the web UI.

## Relevant Capabilities From Stripped Plover
- **JSON line protocol over STDIO** (`translate`, `reset_state`, `import_dictionary`, etc.).
- **Stateful translation** with multi-stroke outlines and undo (`*` stroke).
- **IME output model**: responses include ordered output elements (`committed`, `keypress`, `preedit`).
- **Dictionary stack control** via RPC or `{PLOVER:...}` commands.
- **SQLite-backed dictionaries** loaded through `import_dictionary` calls.

## Observed Constraints
- **Not browser-native**: requires Node.js + SQLite; must run on server/sidecar.
- **Stateful per client**: A single Stripped Plover process maintains state; multiple users need separate instances or per-session state handling.
- **License**: Stripped Plover is GPL-2.0-or-later licensed, while this repo is 0BSD. Integrating it directly (bundling) may require legal review. Using it as a separate process over IPC can limit licensing implications, but still needs review. **Recommendation**: obtain legal guidance before any integration work.

## Proposed Integration Architecture
### 1) Backend Bridge
- **Spawn Stripped Plover** from the server (Rust or separate Node service) and communicate via STDIO.
- **Bridge API**: expose a new endpoint (e.g., `/plover/translate`) or WebSocket that forwards `translate` requests and returns the JSON output array.
- **Session handling**:
  - For a single-user demo, one process is enough.
  - For multi-user, spawn one process per session or use a worker pool + session routing.
- **Lifecycle**: On page load/focus change, send `reset_state`. On shutdown, send `quit`.

### 2) Dictionary Loading
- Use `import_dictionary` to load English steno dictionaries from JSON/Python sources.
- Optionally allow users to upload dictionaries in the UI; forward to `import_dictionary`.
- Use `get_dictionary_state` to sync enabled/disabled dictionary status with UI toggles.

### 3) Frontend Mode Switching
- Add a **mode toggle** in the web UI: `Vietnamese (V7)` vs `English (Plover)`.
- **Vietnamese mode**: keep the existing V7 flow (client-side parsing + `/infer`).
- **English mode**: send serialized strokes to Stripped Plover and render IME output.
- Suggested UI state:
  - Maintain **separate buffers** for each mode so switching does not discard work.
  - In English mode, render `preedit` text as a composing region (e.g., underlined). Append `committed` text to the buffer.

## Stroke Serialization Mapping
The current QWERTY → steno conversion already constructs a Plover-style stroke string (e.g., `S-P`, `TP-PL`, `*`). This can be reused for Stripped Plover with minor checks:
- Ensure the stroke string uses RTFCRE ordering and inserts the hyphen when no vowel/asterisk is present (already done in `script.js`).
- Preserve `*` for undo, and keep `-` for right-hand-only strokes.
- Stroke handling options:
  - **Buffered outlines**: join strokes with `/` when you already have the full outline (e.g., replaying stored steno logs) and send one `translate` request per outline.
  - **Live input**: send strokes individually (no `/`) so Stripped Plover can manage outline state and undo behavior stroke-by-stroke.

## Output Handling in the Web UI
Stripped Plover responses include an `output` array (ordered):
1. `committed` — append permanently to the English buffer.
2. `keypress` — execute the shortcut (e.g., Ctrl+C) or ignore for web-only usage.
3. `preedit` — replace the current composing text.

Suggested UI behavior:
- If `preedit` is present, render it distinct from committed text (underline or lighter color).
- If a `keypress` is returned, commit the current preedit before executing it, mirroring Stripped Plover’s semantics.

## Minimal Implementation Steps (High-Level)
1. **Backend**: add a sidecar process manager (Rust `tokio::process` or a small Node service) that speaks the JSON line protocol and exposes an HTTP/WebSocket bridge.
2. **Frontend**: add a mode toggle, route strokes to either V7 (`/infer`) or Stripped Plover (`/plover/translate`).
3. **State**: maintain separate buffers and reset Stripped Plover state when switching to avoid mixing preedit contexts.
4. **Dictionary loading UI** (optional): allow import or selection of dictionary sets for English mode.

## Open Questions / Risks
- **Licensing**: verify that using Stripped Plover as a sidecar process complies with 0BSD licensing expectations.
- **Multi-user support**: determine whether the demo is single-user or should support per-session instances.
- **Keypress handling**: decide whether to honor or ignore keypress outputs (e.g., Ctrl+C) in a web-only environment.

## References
- Stripped Plover README: https://github.com/huynhtrankhanh/strippedplover
- Stripped Plover Protocol: https://github.com/huynhtrankhanh/strippedplover/blob/main/PROTOCOL.md
