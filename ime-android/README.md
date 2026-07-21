# V7 IME for Android

`ime-android` packages the V7 WebUI as an Android input method with application ID
`com.huynhtrankhanh.v7ime`.

The IME requires Android 8.0 (API 26) or newer. API 26 is the minimum supported
by AndroidX JavaScriptEngine, which owns durable out-of-process dictionary
imports.

## Architecture

- Android uses the dedicated `static/ime.html` and `static/ime.css` interface,
  while sharing the inference and input behavior compiled into `static/script.js`.
  The traditional `static/index.html` WebUI remains structurally and visually
  independent.
- `V7ImeService` hosts that UI in a `WebView`. The WebUI detects
  `window.AndroidIme`, enables stripped display mode, and mirrors its current
  rendered text into Android composing text.
- External hardware key-down and key-up events are captured by the IME and
  forwarded to the WebUI as browser `KeyboardEvent`s. The IME does not render
  an on-screen key layout.
- Inference requests go through JNI to the bundled `inference-rs` and KenLM
  code. No inference request leaves the device.
- The language model is not bundled. Android retains a Storage Access Framework
  document grant and passes its seekable file descriptor directly to KenLM,
  which memory-maps it without copying the model into app-private storage.
- Stripped Plover is bundled as a local browser runtime in a process-wide,
  non-visual WebView separate from both the IME interface and dictionary
  manager. Its persistence bridge uses Android's private native SQLite
  database; no Node runtime or external server is required.
- Moving the cursor or changing editors finishes the active composition and
  clears the WebUI buffer, so already-entered text remains in the editor while a
  new composing session starts cleanly.
- On Android 12 and later, the two candidate-difference regions are attached to
  composing text as grammar `SuggestionSpan`s with their alternative phrases.
- Physical Enter is handled by the service rather than the WebUI: it invokes an
  editor-provided custom or standard action when present, otherwise it forwards
  the original Enter key events to the editor.
- The physical Ctrl+Shift chord switches between STENO capture and ordinary
  hardware-keyboard typing. The chord toggles once per press cycle while solo
  Ctrl and Shift retain their ordinary behavior.
- Normal typing uses a labeled 48 dp status bar, matching the compact active
  Stripped Plover treatment instead of leaving the composition UI visible.
- While STENO capture is active, the physical Q+A chord opens Android's input
  method picker. The `[` key commits the current PREEDIT and starts a clean
  composing session; it does not delete the committed text.
- Connecting or disconnecting a physical keyboard restores the V7 input view
  when an editor is still active. A generation guard prevents a delayed restore
  from showing the IME over an editor that has already closed or changed.

See [Android hardware-keyboard interactions](docs/hardware-keyboard-interactions.md)
for the complete mode table, PREEDIT semantics, and native/WebUI event-routing
order.

See [Virtual-keyboard visibility with an external keyboard](docs/keyboard-visibility.md)
for the attach/detach recovery policy, lifecycle safeguards, and verification
matrix.

## Settings

Open **V7 IME** from the launcher or tap its settings entry in Android's
keyboard settings. The native settings activity includes:

- a local `lm.binary` document selected with Android's Storage Access
  Framework;
- a full-screen Stripped Plover dictionary manager opened from settings,
  reusing a phone-friendly browser UI without nesting editable fields inside
  the IME;
- durable background dictionary imports in AndroidX's out-of-process
  JavaScript sandbox, with entry counts, phases, and a determinate loading
  notification while native SQLite installs the source transactionally;
- export and import controls for the complete app-private Stripped Plover
  SQLite database;
- an option to save the APK's complete Corresponding Source as
  `v7-ime-source.zip`;
- shortcuts to enable V7 IME and open the input-method picker.

See [Stripped Plover dictionary management on Android](docs/dictionary-management.md)
for the shared WebUI architecture, the deliberately narrow native bridge, and
the import/export file flow.

See [App-data import and export](docs/app-data-transfer.md) for the database
file format, replacement safeguards, and the data that is intentionally not
part of an export.

See [Bundled Stripped Plover runtime](docs/bundled-stripped-plover.md) for the
pinned external-source build, separate engine WebView, background JavaScript
sandbox, typechecked Node compatibility surface, native SQLite implementation,
and artifact licensing boundary.

The bundled Android distribution, including the APK and its Stripped Plover
runtime, is conveyed as a combined work under GPL-3.0-or-later. The APK bundles
its complete Corresponding Source as `v7-ime-source.zip`; Settings can save
that exact asset without network access. The archive contains this repository
plus the exact pinned KenLM and Stripped Plover checkouts, and intentionally
excludes user language models.

Original V7 source files remain separately available under 0BSD. The
distribution-level GPL notice does not replace their 0BSD license, transfer
their copyright, or replace the respective notices on Stripped Plover, KenLM,
and other third-party components.

## IME interface

The IME is a compact companion for an external steno keyboard. It keeps the
reduced composing buffer and fitted alternatives visible without drawing an
on-screen key layout. Its height follows the content: the empty and short-text
states stay compact, while longer text and alternatives receive more room.

<img src="docs/ime-empty.png" width="412" alt="Compact empty V7 IME inviting the user to begin a hardware chord">

Each alternative uses only the width its summary needs. Alternatives pack
beside one another and wrap onto another row only when the remaining width is
insufficient. Android expands the IME to fit those rows; the candidate area
becomes vertically scrollable only after the safe screen-height cap is reached.

<img src="docs/ime-candidates.png" width="412" alt="V7 IME showing the reduced composing buffer and three candidate alternatives">

Piecemeal mode keeps natural spaces between editable syllables. Its highlight
does not shift the surrounding text, including when the active target is in the
middle of the phrase:

<img src="docs/ime-piecemeal-edit.png" width="412" alt="V7 IME showing naturally spaced numbered syllables with a middle syllable active for piecemeal editing">

While Stripped Plover is active, the composition interface collapses to a
48 dp status bar:

<img src="docs/ime-plover.png" width="412" alt="Thin V7 IME status bar showing that Stripped Plover is active">

## Build

The Android build invokes the root WebUI build, fetches and browser-bundles the
pinned Stripped Plover revision, compiles Rust/KenLM for Android, and creates
the source ZIP asset. Install the root JavaScript dependencies, Rust 1.88,
`cargo-ndk`, Android NDK 27.2.12479018, and Gradle 8.9:

```sh
npm ci
rustup target add \
  aarch64-linux-android armv7-linux-androideabi \
  x86_64-linux-android i686-linux-android
cargo install cargo-ndk --version 4.1.2 --locked
ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018" \
  gradle -p ime-android assembleDebug
```

The APK is written to:

```text
ime-android/app/build/outputs/apk/debug/app-debug.apk
```
