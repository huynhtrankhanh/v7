# V7 Android IME

V7 is a Vietnamese input method for Android, designed for an external QWERTY or steno keyboard. It combines deterministic single-syllable entry, predictive two-syllable V7 islands, Telex, and bundled Stripped Plover. Inference runs locally through Rust and KenLM.

**The WebUI serves Android IME and its settings only.** The separate 60-second practice interface and its Android wrapper remain supported. This is the project's single README; focused reference documents remain linked below.

- [Android architecture](#architecture), [settings](#settings), [IME build](#build-the-android-ime), and [releases](#signed-release-pipeline)
- [Keyboard layout](#stenographic-layout), [single-syllable rules](#single-syllable-mode-orthographic-rules-deterministic), [two-syllable rules](#v7-island-rules-two-syllable-islands), and [usage](#usage)
- [Clipboard slots](CLIPBOARD_SLOTS.md)
- [Training](#language-model-training), [headless inference](#headless-inference-and-practice-server), and [V7 code format](#v7-input-format-deep-dive)
- [Practice game and Android bundle](#60-second-practice-interface)
- [Development and validation](#development-and-validation)

## Project structure

| Path | Purpose |
| --- | --- |
| `ime-android/` | Android IME, native bridges, settings, JNI, and bundled Plover integration. |
| `src/ime.ts` | Android composition and settings WebView controller; requires `AndroidIme` or `AndroidDictionary`. |
| `src/editorCore.ts`, `src/textBuffer.ts`, `src/undoManager.ts` | Editor rendering, island buffer, and undo logic. |
| `static/ime.html`, `static/ime.css`, `static/dictionary.html`, `static/plover-dictionary.css` | APK-only composition and settings UI assets. |
| `static/script.js` | Generated IME bundle; built by Vite and excluded from Git. |
| `inference-rs/` | Shared Rust/KenLM inference engine, Android JNI library, CLI, and headless HTTP API. |
| `static/practice.html`, `practice-android/` | Independent 60-second practice game and its Android app. |
| `tests/`, `scripts/` | Unit tests, Android WebView bridge checks, practice checks, and build helpers. |
| `preprocess_corpus.py`, `preprocess_corpus.cpp`, `train_lm.sh` | Corpus preprocessing and language-model training. |
| `Dockerfile`, `Dockerfile.practice-android`, `docker-compose.yml` | Headless inference, training, and practice builds. |
| `lm.binary` | Generated language model, selected by the user on Android; not bundled or tracked. |

`ime-android` packages the V7 WebUI as an Android input method with application ID
`com.huynhtrankhanh.v7ime`.

V7 composition includes ten persistent clipboard slots: **Alt+0–9** copies the
composition or its selection, and **Ctrl+0–9** appends exact fixed text with normal
`*` undo. Open **Clipboard slots** beneath the toolbar to preview, paste, or clear
items by touch. Slots remain available after IME restarts and are hidden outside
V7 mode. See [clipboard slot UX and behavior](CLIPBOARD_SLOTS.md), including
Android hardware routing and persistence details.

The IME requires Android 8.0 (API 26) or newer. API 26 is the minimum supported
by AndroidX JavaScriptEngine, which owns durable out-of-process dictionary
imports.

## Architecture

- Android uses the dedicated `static/ime.html` and `static/ime.css` interface,
  with inference and input behavior compiled into `static/script.js`. These
  assets exist solely for Android IME and its settings dictionary manager.
- `V7ImeService` hosts that UI in a `WebView`. The WebUI detects
  `window.AndroidIme`, enables stripped display mode, and mirrors its current
  rendered text into Android composing text.
- V7/Plover hardware events are forwarded to the WebUI as browser
  `KeyboardEvent`s. Telex hardware input is handled natively; only its pure
  linguistic conversion runs synchronously in a DOM-free AndroidX
  `JavaScriptSandbox`. The IME does not render an on-screen key layout.
- Telex and dictionary importing share the application's single sandbox using
  separate isolates. Telex loads and warms its tone oracle in the background;
  its banner explicitly reports Latin fallback until conversion is ready.
- Inference requests go through JNI to the bundled `inference-rs` and KenLM
  code. No inference request leaves the device.
- Settings can replace the bundled two-syllable lexical dictionary with a
  persistently selected UTF-8 `.txt` document. Each LF- or CRLF-delimited line
  must contain exactly two words; malformed and non-V7 entries are ignored.
  The optional file is opened only for dictionary-mode requests, so an
  unavailable provider cannot disable compositional inference. Provider
  modification metadata is checked in the background at most once per second
  during dictionary-mode typing. Edits become visible on a subsequent stroke
  after the refresh completes; reselection invalidates the cache immediately.
  The first use loads the dictionary, while unchanged dictionaries are neither
  reread nor copied into Rust on subsequent strokes.
- The language model is not bundled. Android retains a Storage Access Framework
  document grant and passes its seekable file descriptor directly to KenLM,
  which memory-maps it without copying the model into app-private storage.
  The descriptor is opened only when loading or switching models; subsequent
  inference requests reuse the native engine without contacting the provider.
- Stripped Plover is bundled as a local browser runtime in a process-wide,
  non-visual WebView separate from both the IME interface and dictionary
  manager. Its persistence bridge uses Android's private native SQLite
  database; no Node runtime or external server is required.
- Stripped Plover's host-command events use native Android surfaces:
  `{PLOVER:LOOKUP}` opens an entry lookup whose rows name their source
  dictionary, `{PLOVER:ADD_TRANSLATION}` opens an add form with a writable
  dictionary picker, and `{PLOVER:CONFIGURE}` opens V7 IME settings directly.
- The lookup stroke and add-translation outline fields mark their editor
  context for raw outline capture. V7 then joins physical steno chords with `/`
  and collapses to a labeled 48 dp **Raw outline mode** bar. A lone `*` chord
  removes the latest slash-delimited stroke from the textbox. Translation and
  lookup-text fields use standard V7 and preserve the user's current
  STENO/Normal selection, including the Ctrl+Shift toggle.
- Native command dialogs request the IME surface as soon as their first editor
  is focused, retain it during keyboard navigation, and do not close from an
  accidental outside touch.
- Add-translation uses one-tap, 48 dp dictionary choices; dialog navigation
  keys return to the native activity while those controls have focus, without
  consuming V7's Ctrl+Shift toggle or changing its saved mode. Outline Enter
  advances to translation, and translation Enter submits.
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
- `Ctrl+Tab` switches between V7/Stripped Plover and Telex composition. From
  Normal typing it enters Telex directly; `Ctrl+Shift` from Telex enters Normal
  typing, while `Ctrl+Shift` from Normal typing returns to V7/Plover. Telex
  keeps the current word as Android PREEDIT, supports ordinary Latin text via
  repeated-mark escapes, and commits/ends PREEDIT at whitespace or symbols.
  Empty-PREEDIT Backspace passes through to the editor, and Enter retains the
  editor's standard Android action behavior after finalizing PREEDIT.
  Numpad and layout-specific printable keys also terminate PREEDIT rather than
  bypassing the Telex composer.
- Normal typing uses a labeled 48 dp status bar, matching the compact active
  Stripped Plover treatment instead of leaving the composition UI visible.
  Compact transitions apply their height immediately, and returning to V7
  restores the last measured full height before the first expanded paint.
- The IME HTML starts with the same empty composition markup used after
  JavaScript initialization and applies native compact-mode classes before its
  layout is parsed, preventing placeholder and full-height layout flicker.
- While STENO capture is active, the physical Q+A chord opens Android's input
  method picker. The `[` key commits the current PREEDIT and starts a clean
  composing session; it does not delete the committed text. The apostrophe key
  commits the current PREEDIT and inserts one space.
- Every physical event carries Android's current Caps Lock state into the
  WebUI. While that state is on, all cased characters produced anywhere in the
  steno pipeline are uppercase, including direct and inferred V7, Emily,
  Stripped Plover, candidate previews, piecemeal replacements, and selected
  candidate output. Choosing a candidate preserves the casing assigned when
  its output was produced; Caps Lock at selection time does not retroactively
  uppercase older candidate or fixed text.
- Connecting or disconnecting a physical keyboard restores the V7 input view
  when an editor is still active. A generation guard prevents a delayed restore
  from showing the IME over an editor that has already closed or changed.

See [Android hardware-keyboard interactions](ime-android/docs/hardware-keyboard-interactions.md)
for the complete mode table, PREEDIT semantics, and native/WebUI event-routing
order.

See [Telex behavior](ime-android/docs/telex-behavior.md) for the three-mode state machine
and [the supplied Telex adapter supplement](ime-android/docs/telex-behavior-supplement.md)
for the converter's detailed key and tone-placement rules.

See [Virtual-keyboard visibility with an external keyboard](ime-android/docs/keyboard-visibility.md)
for the attach/detach recovery policy, lifecycle safeguards, and verification
matrix.

## Settings

Open **V7 IME** from the launcher or tap its settings entry in Android's
keyboard settings. The native settings activity includes:

- a local `lm.binary` document selected with Android's Storage Access
  Framework;
- a full-screen Stripped Plover dictionary manager opened from settings,
  using the dedicated Android settings WebView without an Activity action bar or
  nesting editable fields inside the IME;
- durable background dictionary imports in AndroidX's out-of-process
  JavaScript sandbox, with entry counts, phases, and a determinate loading
  notification while native SQLite installs the source transactionally;
- export and import controls for the complete app-private Stripped Plover
  SQLite database;
- an option to save the APK's complete Corresponding Source as
  `v7-ime-source.zip`;
- shortcuts to enable V7 IME and open the input-method picker.

See [Stripped Plover dictionary management on Android](ime-android/docs/dictionary-management.md)
for the shared WebUI architecture, the deliberately narrow native bridge, and
the import/export file flow.

See [App-data import and export](ime-android/docs/app-data-transfer.md) for the database
file format, replacement safeguards, and the data that is intentionally not
part of an export.

See [Bundled Stripped Plover runtime](ime-android/docs/bundled-stripped-plover.md) for the
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

<img src="ime-android/docs/ime-empty.png" width="412" alt="Compact empty V7 IME inviting the user to begin a hardware chord">

Each alternative uses only the width its summary needs. Alternatives pack
beside one another and wrap onto another row only when the remaining width is
insufficient. Android expands the IME to fit those rows; the candidate area
becomes vertically scrollable only after the safe screen-height cap is reached.

<img src="ime-android/docs/ime-candidates.png" width="412" alt="V7 IME showing the reduced composing buffer and three candidate alternatives">

Piecemeal mode keeps natural spaces between editable syllables. Its highlight
does not shift the surrounding text, including when the active target is in the
middle of the phrase:

<img src="ime-android/docs/ime-piecemeal-edit.png" width="412" alt="V7 IME showing naturally spaced numbered syllables with a middle syllable active for piecemeal editing">

While Stripped Plover is active, the composition interface collapses to a
48 dp status bar:

<img src="ime-android/docs/ime-plover.png" width="412" alt="Thin V7 IME status bar showing that Stripped Plover is active">

## Build the Android IME

The Android build uses JDK 21. It invokes the root WebUI build, fetches and browser-bundles the
pinned Stripped Plover revision, compiles Rust/KenLM for Android, and creates
the source ZIP asset. Install the root JavaScript dependencies, Rust 1.88,
`cargo-ndk`, JDK 21, Android NDK 27.2.12479018, and Gradle:

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

## Signed release pipeline

The manual **Generate V7 IME Release App Bundle** GitHub Actions workflow builds
a signed release App Bundle (`.aab`) from a version name, an optional Android
`versionCode`, and a signing password. It uploads the App Bundle, its SHA-256
checksum, matching bundle/key certificate fingerprints, and a compressed
artifact bundle.

The same flow is available locally after installing the Android, Node, Rust,
and NDK dependencies above:

```sh
V7_SIGNING_PASSWORD='your signing password' \
  ime-android/scripts/build-release-aab.sh "1.0.0" 100
```

Artifacts are written to `android-artifacts/` by default. The release script
derives a deterministic PKCS#12 key from the password when no upload key is
provided. For Play uploads, provide the registered key through
`SIGNING_STORE_FILE`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`, and
`SIGNING_KEY_PASSWORD` (plus `SIGNING_STORE_TYPE` when it is not PKCS#12); the
script verifies the generated App Bundle with
`jarsigner`, records the bundle and key SHA-1/SHA-256 certificate fingerprints,
and fails if they differ.

Keep the same derived signing password for compatible updates, or use the
registered Play upload key. The private keystore is temporary build material
and is never copied into `android-artifacts/`.

## Island Types & Spacing Rules

The frontend organizes text into "islands" to manage spacing intelligently. The types are:

*   **Vietnamese (`vietnamese`):** Literal syllable text.
*   **V7 (`v7`):** Predictive codes with compositional or dictionary inference.
*   **Plover (`plover`):** Literal output with a committed or preedit phase.
*   **Punctuation:** `.` `,` `!` `?`.
*   **Capital Letter:** Literal uppercase letters.
*   **Spacing:** Explicit Space or Newline.
*   **Emily:** Symbol output with explicit attachment spacing.
*   **Fixed clipboard text:** Literal slot output with exact whitespace at both boundaries.

**Spacing Rules:**
*   **Vietnamese ↔ Vietnamese:** Space added.
*   **Vietnamese → Capital:** Space added (e.g., `Xin Chào`).
*   **Punctuation → Vietnamese:** Space added (e.g., `. Xin`).
*   **Punctuation → Capital:** Space added (e.g., `. A`).
*   **Capital → Capital:** No space (e.g., `USA`).
*   **Capital → Vietnamese:** Space added.
*   **Punctuation → Punctuation:** No space.
*   **Any ↔ Spacing:** No extra space added.
*   **Emily Symbols:** Explicit attachment metadata controls whether spacing is added around the symbol.

### Island model for contributors

`Island` in `src/textBuffer.ts` is a discriminated union: narrow `island.type`
before accessing variant-specific fields. Construct islands with
`createIsland(type, value, options)`; its options and return type follow the
chosen type. The complete argument tuple must match one island variant; narrow
a union-valued type before calling the constructor with variant-specific options.
V7 islands require one `capitalization` choice (`none`, `initial`,
or `upper`) and one `validation` state (`pending`, `valid`, or `invalid`). The
factory defaults to compositional mode, no capitalization, and pending
validation. Only dictionary mode exposes `dictionaryBucketSize`; starting a
new inference request discards the previous result metadata. Plover islands
carry `phase: "committed" | "preedit"` and default to committed.

An optional `spacing: { before, after }` overrides automatic boundary spacing.
The right island's `before` takes precedence over the left island's `after`;
explicit space/newline islands always suppress extra spacing. Vietnamese, V7,
and Plover islands share the normal syllable spacing and piecemeal rules.
Clipboard islands default to `{ before: false, after: false }` and remain
literal, including their whitespace. Undo retains the complete island variant
and its metadata. The Android inference wire format remains version 2 with
`kind: "fixed"` and `kind: "v7"`; frontend variants are converted at that boundary.

## Stenographic Layout

The IME uses a QWERTY-to-Steno mapping:

![Steno Keyboard Layout](static/keyboard.svg)

| QWERTY | Steno | QWERTY | Steno |
| :--- | :--- | :--- | :--- |
| `Q` | `#` | `U` | `-F` |
| `A` | `S-` | `J` | `-R` |
| `W` | `T-` | `I` | `-P` |
| `S` | `K-` | `K` | `-B` |
| `E` | `P-` | `O` | `-L` |
| `D` | `W-` | `L` | `-G` |
| `R` | `H-` | `P` | `-T` |
| `F` | `R-` | `;` | `-S` |
| `C` | `A` | `T, G` | `-D` |
| `V` | `O` | `Y, H` | `-Z` |
| `N` | `E` | `Space` | `*` |
| `M` | `U` | | |

### Space & Newline
- `S-P`: Inserts a Space Island.
- Physical `Enter` finishes composition and invokes the Android editor action, or forwards Enter when no action is supplied.

### Literal Uppercase
- `Shift + [Letter]`: Appends the uppercase letter literally as a Capital Island. Spacing is determined by the spacing rules (e.g. no space if previous was capital).
- `Caps Lock`: While the keyboard's current Caps Lock state is on, every cased character produced by the steno pipeline is uppercase—not only inferred V7 islands. The state captured with each physical key event applies to direct syllables, Emily output, Stripped Plover output, previews, alternatives, and piecemeal edits. Choosing a candidate preserves the casing already attached to its output; the Caps Lock state of the selection action never retroactively uppercases older candidate or fixed text.

### Punctuation
Standard steno chords for punctuation:
- `TP-PL`: Period (`.`)
- `KW-BG`: Comma (`,`)
- `KW-PL`: Question mark (`?`)
- `TP-BG`: Exclamation mark (`!`)

Punctuation marks are inserted as Punctuation Islands without trailing spaces. Spacing after punctuation is handled automatically by the spacing rules.

### Emily Symbols
Emily symbol strokes use the `WH` starter. The capitalization command is left-hand `WHR` rather than `WH*`, avoiding a collision with two-syllable V7 mode; the right-hand `WH-R` chord remains the period symbol. Attachment keys control spacing around the symbol in the `space` attachment method:
- No attachment keys: no surrounding spaces (symbol attaches to both sides).
- `A`: insert space before the symbol.
- `O`: insert space after the symbol.
- `AO`: insert spaces on both sides.

Spacing is not applied for `{*!}` and `{*?}` retrospective space macros.

## IME composition display

The composition view shows the nine rightmost Vietnamese syllables with piecemeal numbers and highlights. Intervening non-Vietnamese runs of up to three characters remain visible; longer runs become `…`. An empty buffer shows 👋. The candidate panel is hidden without alternatives and omits candidate 1 (`current`), which is already shown in the buffer. Red and black diff regions identify the two useful change sections; their ranges are also logged for debugging.

There is no standalone editor, raw-text textarea, browser clipboard override, keyboard-debug display, or `setStrippedDisplay` embedding API. Q+A (`#S`) opens Android's input-method picker. Ctrl+C and other ordinary editor shortcuts retain their Android host behavior. Clipboard slots are app-private: Alt+0–9 copies the IME composition or its selection, Ctrl+0–9 appends exact fixed text, and normal `*` undo removes each paste. See [clipboard slots](CLIPBOARD_SLOTS.md) for selection, persistence, clearing, and native-routing details.

## Stripped Plover controls

Press the `#` stroke (physical Q) to toggle Stripped Plover. While enabled, all strokes go to the bundled runtime and the IME collapses to its 48 dp status bar. While disabled, strokes that do not match V7's built-in rules may be translated as one-shot Plover strokes.

Manage dictionaries from Android settings: refresh, reorder, enable/disable, solo/end solo, export, rename, and delete writable dictionaries; import JSON or Python dictionaries and optionally merge JSON; search/edit entries by stroke or translation; and perform stroke or reverse lookup. The dictionary manager runs in a separate settings activity with `AndroidDictionary`, while composition uses `AndroidIme`. Both call the app-local runtime rather than a server.

## Single-Syllable Mode Orthographic Rules (Deterministic)

This section is the complete rule set for **single-syllable mode** (i.e., strokes entered **without** `*` held). It is intentionally exhaustive so you can determine exactly what every valid stroke will output.

### Parsing Order (strict, greedy, left-to-right)

For single-syllable mode, each stroke is parsed in this exact order:

1. Optional capitalization marker: `#`
2. Optional on-glide marker: `S`
3. Initial consonant (longest match, 4 keys -> 1 key)
4. Vowel nucleus (longest match, 4 keys -> 1 key) **(required)**
5. Final consonant (longest match, 2 keys -> 1 key, optional)
6. Tone (all remaining keys, optional)

If any stage fails (especially vowel or leftover tone parsing), the stroke is **ignored** (no text output, no state mutation).

### 1) Initial Consonants (after optional `#` and optional leading `S`)

| Steno Keys | Sound | Steno Keys | Sound |
| :--- | :--- | :--- | :--- |
| `PW` | b | `TPH` | n |
| `K` | c | `TPR` | nh |
| `KH` | ch | `TPW` | ng/ngh |
| `KWR` | d | `P` | p |
| `TK` | đ | `R` | r |
| `TP` | ph | `KP` | s |
| `TKPW` | g/gh | `T` | t |
| `H` | h | `TH` | th |
| `KWH` | gi | `TR` | tr |
| `KHR` | kh | `W` | v |
| `HR` | l | `WR` | x |
| `PH` | m | | |

Additional deterministic onset orthography:

- Define vowel classes used below:
  - **Back-vowel group:** `a, ă, â, o, ô, ơ, u, ư, ua/uô, ưa/ươ`
  - **Front-vowel group:** `e, ê, i, iê/ia, y`
- `TPW` (`ng/ngh`) outputs:
  - `ng` when on-glide is present OR vowel is in the back-vowel group
  - `ngh` otherwise (front-vowel group)
- `TKPW` (`g`) outputs:
  - `g` when on-glide is present OR vowel is in the back-vowel group
  - `gh` otherwise
- `KWH` (`gi`) outputs:
  - `g` when **no on-glide** and vowel is `i` or `iê/ia`
  - `gi` in all other cases
- `K` (`c`) outputs:
  - `q` when on-glide is present
  - `c` when no on-glide and vowel is in the back-vowel group
  - `k` when no on-glide and vowel is in the front-vowel group

### 2) Vowels (required nucleus)

| Steno Keys | Sound | Steno Keys | Sound |
| :--- | :--- | :--- | :--- |
| `A` | a | `OEU` | iê/ia |
| `AE` | ă | `AEU` | ua/uô |
| `AO` | â | `AOE` | ưa/ươ |
| `E` | e | `AOU` | ư |
| `AU` | ê | `OU` | ơ |
| `EU` | i | `OE` | ô |
| `O` | o | `AOEU` | y |
| `U` | u | | |

### 3) Final Consonants (optional coda)

| Steno Keys | Sound | Steno Keys | Sound |
| :--- | :--- | :--- | :--- |
| `FP` | j (i/y) | `RP` | nh |
| `F` | w (u/o) | `P` | m |
| `R` | n | `FR` | ng |

Final rendering rules:

- `F` (`w`) renders as:
  - `u` if vowel is one of: `iê/ia, ư, ưa/ươ, ê, u, ă, â, i`
  - `o` otherwise
- `FP` (`j`) renders as:
  - `y` if vowel is `ă` or `â`
  - `i` otherwise
- `P`, `R`, `FR`, `RP` usually render as `m`, `n`, `ng`, `nh`, except under stop-tone conversion (below).

### 4) Tones (remaining right-hand keys after coda parsing)

Tones are determined by the remaining keys after matching the final consonant.

| Steno Keys | Tone | Diacritic | Example |
| :--- | :--- | :--- | :--- |
| *(None)* | Ngang | (none) | ma |
| `L` | Sắc | Acute (´) | má |
| `G` | Huyền | Grave (`) | mà |
| `B` | Hỏi | Hook (?) | mả |
| `LG` | Ngã | Tilde (~) | mã |
| `BG` | Nặng | Dot (.) | mạ |
| `BL` | Sắc (Stop) | Acute (´) | mát |
| `BLG` | Nặng (Stop) | Dot (.) | mạt |

Stop-tone conversion (`BL` / `BLG`) is strict:

- Allowed only when steno coda is one of:
  - `P` -> output coda `p`
  - `R` -> output coda `t`
  - `FR` -> output coda `c`
  - `RP` -> output coda `ch`
- `BL` forces tone to `sắc`; `BLG` forces tone to `nặng`.
- This reflects Vietnamese checked-syllable orthography where stop codas are written `-p/-t/-c/-ch` rather than the nasal outputs of `P/R/FR/RP`.
- If `BL`/`BLG` appears with no coda or with codas `F`/`FP`, the stroke is **invalid and ignored**.

### 5) On-Glide (`S` immediately after optional `#`)

On-glide is only read from the **leading** `S` position (before onset parsing). It modifies nucleus construction as follows:

- General rule:
  - open syllable (no coda): prefix `o` before the nucleus
  - closed syllable (has coda): prefix `o` and attach tone mark to the main vowel letter
- Specialized behavior by vowel:
  - `iê/ia`:
    - no coda -> `uy` + accented `a`
    - has coda -> `uy` + accented `ê`
  - `i`:
    - has coda -> `u` + accented `y`
    - no coda:
      - if onset is `c` -> `u` + accented `y`
      - otherwise -> accented `u` + `y`
  - `ă` with rendered coda `w/j` (from steno codas `F`/`FP`): replaces base with accented `a`; prefix is:
    - `u` if onset is `c`
    - `o` otherwise
  - `â` or `ê`: uses `u` + accented vowel (not `o` prefix form)
  - any vowel with onset `c`: uses `u` + accented vowel (reflects `qu...` behavior)

### 6) Vowel-shape resolution rules (what actually gets written)

These are applied after parse and before final coda rendering:

- `iê/ia`:
  - no coda -> `ia` form (with proper tone placement)
  - has coda -> `iê`/`yê` form (tone on `ê`)
  - onset empty + no on-glide + has coda uses `yê...`
- `ua/uô`:
  - no coda -> `ua` (tone on `u`)
  - has coda -> `uô` (tone on `ô`)
- `ưa/ươ`:
  - no coda -> `ưa` (tone on `ư`)
  - has coda -> `ươ` (tone on `ơ`)
- `ă` + (`w` or `j` coda): nucleus written with `a`-tone series (orthographic `au/ay`-type behavior).

### 7) Capitalization (`#`)

`#` uppercases the first output character of the assembled syllable.

### 8) Complete validity / ignore conditions

A single-syllable stroke is ignored if any of these occurs:

1. No valid vowel can be matched after optional `#`, optional leading `S`, and onset parsing.
2. After optional coda parsing, remaining keys are neither empty nor a valid tone key sequence.
3. `BL`/`BLG` is used without a compatible coda (`P`, `R`, `FR`, `RP`).
4. Any extra unmatched key remains at the end of parse.

### 9) Step-by-step deterministic input recipe

To enter a syllable with certainty:

1. Decide whether syllable-initial capitalization is needed (`#` or not).
2. Decide whether you need on-glide (`S` before onset) for `o/u` medial behavior (`qua`, `hoa`, `uy...` patterns).
3. Enter onset keys using the longest onset pattern from the table.
4. Enter exactly one vowel pattern (longest match principle).
5. Optionally enter one coda pattern.
6. Optionally enter tone keys:
   - plain tones: `L`, `G`, `B`, `LG`, `BG`
   - stop tones only with stop codas: `BL` or `BLG`
7. Ensure no extra keys remain; otherwise the stroke will be ignored.

### 10) Practical certainty notes

- The parser is greedy for onset and vowel; if two options share prefixes, the longest valid one wins.
- On-glide is only the leading `S`, not any later `S` that belongs to another pattern.
- Single-syllable mode is strictly orthographic assembly; there is no language-model inference in this path.
- If a stroke is ignored, nothing is partially committed.

## V7 Island Rules (Two-Syllable Islands)

A V7 Island allows encoding two syllables in a single stroke by using the keyboard as two separate halves. Ordinary, compositional V7 uses `*` (Spacebar). Dictionary mode carries the same two-syllable code but first restricts inference to lexical dictionary pairs: flip both `D` and `Z` on the ordinary chord. When both vowels are `e` or `u`, use the symmetric starless forms `* → -DZ`, `*Z → EDZ`, `*D → ODZ`, and `*DZ → OEDZ`. Redundant `D` with left `A/O` and `Z` with right `E/U` are therefore dictionary forms, not ordinary aliases.

If the selected dictionary has no entry for a dictionary-mode code, the engine falls back to the full compositional candidates and ranks them with KenLM using zero preceding context. Thus a missing lexical entry does not produce a dictionary miss. Before inference completes, the IME displays ordinary codes as `[code1code2]` and dictionary codes as `[D: code1code2]`. If either constituent code has no inference candidates, the corresponding illegal form is `[I: code1code2]` or `[DI: code1code2]` in dictionary mode.

**Structure:** `[Left Syllable]*[Right Syllable]`

#### Keyboard Zones (Mirrored Layout)

The V7 layout is designed to be **perfectly mirrored** between the left and right hands.

![V7 Layout Zones](static/v7_layout_zones.svg)

*   **Left Hand:** Uses the standard QWERTY keys `Q, W, E, R, A` for consonants, `S, D, F` for tones, and `C, V` for vowels.
*   **Right Hand:** Mirrors the left hand using `P, O, I, U, ;` for consonants, `L, K, J` for tones, and `N, M` for vowels.

#### Consonant Patterns (Onsets)

The following patterns show which keys to press for each consonant. The dots represent the relative positions of the 5 consonant keys for each hand.

![V7 Consonant Bitmasks](static/v7_onsets.svg)

#### Tone and Vowel Patterns

Tones use 3 bits (3 keys), while vowels use 2 bits (2 keys).

![V7 Tones and Vowels](static/v7_tones_vowels.svg)

#### Component Mappings

#### Consonants
| Consonant | Left Hand Keys | Right Hand Keys |
| :--- | :--- | :--- |
| **0** | `(None)` | `(None)` |
| **b** | `# + S + P` | `-T + -S + -P` |
| **ch** | `S + T + H` | `-S + -L + -F` |
| **d** | `# + T + P + H` | `-T + -L + -P + -F` |
| **dd** | `# + S + T` | `-T + -S + -L` |
| **g** | `# + S + T + P` | `-T + -S + -L + -P` |
| **h** | `H` | `-F` |
| **k** | `# + T` | `-T + -L` |
| **kh** | `# + S + T + H` | `-T + -S + -L + -F` |
| **l** | `# + S + H` | `-T + -S + -F` |
| **m** | `P + H` | `-P + -F` |
| **n** | `T + P + H` | `-L + -P + -F` |
| **ng** | `# + T + P` | `-T + -L + -P` |
| **nh** | `# + S + T + P + H` | `-T + -S + -L + -P + -F` |
| **p** | `P` | `-P` |
| **ph** | `T + P` | `-L + -P` |
| **r** | `# + H` | `-T + -F` |
| **s** | `S + T + P` | `-S + -L + -P` |
| **t** | `T` | `-L` |
| **th** | `T + H` | `-L + -F` |
| **tr** | `# + T + H` | `-T + -L + -F` |
| **v** | `# + P` | `-T + -P` |
| **w** | `# + S` | `-T + -S` |
| **x** | `# + P + H` | `-T + -P + -F` |
| **z** | `S + T + P + H` | `-S + -L + -P + -F` |

#### Vowels
| Vowel | Left Hand Keys | Right Hand Keys | Notes |
| :--- | :--- | :--- | :--- |
| **a** | `A` | `U` |  |
| **o** | `O` | `E` |  |
| **i** | `A + O` | `U + E` |  |
| **e/u** | `(None)` | `(None)` | Default `e`. Becomes `u` if `-D` (Left) or `-Z` (Right) is pressed. |

#### Tones
| Tone | Left Hand Keys | Right Hand Keys |
| :--- | :--- | :--- |
| **Ngang** (0) | `(None)` | `(None)` |
| **Sắc** (1) | `K` | `-G` |
| **Huyền** (2) | `W` | `-B` |
| **Ngã** (4) | `K + W` | `-G + -B` |
| **Hỏi** (3) | `R` | `-R` |
| **Sắc (Stop)** (6) | `K + R` | `-G + -R` |
| **Nặng** (5) | `W + R` | `-B + -R` |
| **Nặng (Stop)** (7) | `K + W + R` | `-G + -B + -R` |

## Usage

**CRITICAL: MODE SWITCHING**

Ordinary strokes distinguish these input modes using the `*` (Spacebar) key:

1.  **Single Syllable Mode:** Type your stroke **WITHOUT** holding down the `*` key.
2.  **V7 Island Mode (Two Syllables):** Type your stroke **WHILE HOLDING DOWN** the `*` key.

Dictionary-mode two-syllable strokes also use the starless center forms described
above; those are recognized as predictive islands before single-syllable decoding.

---

### Single Syllable Entry (Fixed Text)

Most common Vietnamese syllables can be fully specified using standard steno chords. These are immediately converted to text and added to the sentence.

*   **Action:** Press the keys for a single syllable.
*   **Result:** Unambiguous text is inserted immediately.

### V7 Island Entry (Predictive Text)

A V7 island represents two syllables partially specified. This mode leverages the V7 inference engine to predict the best candidates based on the surrounding context.

*   **Action:** Hold down the `*` key (Spacebar) while pressing the keys for the two syllables.
*   **Result:** The IME fits up to four alternatives beneath the current top candidate. The main text buffer shows the inferred text from the top candidate. Raw V7 blocks are shown only when inference is unavailable.
*   **Candidate diffing:** When candidates differ, the UI optimizes over the whole rendered buffer and highlights the smallest useful set of ordered change sections. It may show no boxes when visible candidates are identical, one red region box for a single change region, or red then black region boxes for two separate change regions. A region box can contain multiple syllables; it is not drawn once per syllable.

### Candidate Selection

When candidates are displayed, select one to fix that interpretation, or keep composing to update the predictions. Use the following keys (standard steno chords):
- `-T`: Candidate 1
- `-TS`: Candidate 2
- `-S`: Candidate 3
- `-D`: Candidate 4
- `-Z`: Candidate 5

Selecting a candidate collapses the ambiguity and merges the choice into the fixed text context.
The candidate list mirrors the buffer boxes instead of repeating the entire sentence. Each row shows `current` when it matches the top preview, or shows only the section values that would change: red for the left section, black for the right section. Short section summaries are laid out compactly so more candidates fit on screen.
Candidate selection keys can also be combined with **single-syllable** strokes in the same chord: the candidate is selected first, then the syllable is appended, and this combined action is treated as a single undo step.
When no candidates are active, a valid single-syllable stroke plus the first-candidate suffix `-T` falls back to the syllable alone. For example, `KAOT` outputs the syllable from `KAO` instead of being ignored.
If the combined chord does not form a valid single-syllable stroke, it is ignored.

### Piecemeal Syllable Edit

The text buffer always marks the nine rightmost Vietnamese syllables, including inferred syllables from unresolved V7 islands while candidates are displayed. Syllable numbers count from right to left: `T-` targets syllable 1, the rightmost eligible syllable; `P-` targets syllable 2, one syllable to the left; then `H-`, `TK-`, `PW-`, `HR-`, `K-`, `W-`, and `R-` target syllables 3 through 9.

The selected syllable is shown without its number. Type a valid one-syllable Vietnamese stroke to replace it; even though numbers count from right to left, the cursor advances forward in text order to the next marked syllable on the right, and exits after replacing the rightmost marked syllable. Any invalid stroke or non-syllable stroke exits piecemeal edit mode and is then handled normally. Candidate-selection chords are never combined with piecemeal replacement; when a chord selects a candidate, piecemeal edit exits and the chord is handled by the normal candidate-selection path. A lone selection stroke such as `-T` exits piecemeal and selects candidate 1 when candidates exist; if no candidates exist, it exits piecemeal and does nothing else. A combined first-candidate stroke such as `KAOT` selects candidate 1 and appends `KAO` when candidates exist; if no candidates exist, it still exits piecemeal and appends `KAO` as a normal single syllable.

Fixed text syllables are validated against the generated Vietnamese syllable set. Editing a syllable inside a V7 island splits that island around the replacement and inserts the new syllable as fixed Vietnamese text. Each replacement is undoable with the normal `*` undo stroke, and replacements clear stale candidates before triggering a fresh inference pass.

### Undo

The `*` key (Spacebar) pressed by itself undoes the previous action (syllable entry, island entry, or candidate selection).

---

## Language-model training

The bundled two-syllable dictionary is seeded exclusively from
`data/two_syllable_dictionary.txt`, with one normalized lexical pair per line.
The evaluation corpus is not used to construct dictionary buckets, preventing
benchmark leakage.

## Overview

The training pipeline uses:
- A **Python preprocessor** (`preprocess_corpus.py`) to normalize raw corpus text into KenLM training text.
- **KenLM** (`lmplz` + `build_binary`) to train and binarize a 3-gram language model.

Both are run inside a dedicated **Docker training container**. No manual installation of KenLM or Python packages is required on the host.

## Training with Docker (Recommended)

### Prerequisites

- Docker and Docker Compose installed on the host.
- A raw Vietnamese text corpus at `data/corpus-full.txt` (one sentence per line).

### Run Training

```bash
docker compose run --rm train bash train_lm.sh
```

This single command will:
1. Preprocess `data/corpus-full.txt` into `data/corpus.tok`.
2. Train a 3-gram KenLM model (`lm.arpa`).
3. Binarize the model into `lm.binary` using the trie format with 8-bit quantization.

### Output Artifacts

The runtime artifact is written to the project root. The training service bind-mounts the repository root so generated artifacts survive container removal:

| File | Description |
| :--- | :--- |
| `lm.binary` | Compiled KenLM binary model — loaded by the inference engine at startup. |

`lm.binary` must be present before starting headless inference; select the trained file from Android settings for on-device use.

## What the Preprocessor Does

`preprocess_corpus.py` is the historical training preprocessor. It:
- Lowercases the text.
- Removes non-alphanumeric characters (keeping Vietnamese diacritics).
- Normalizes whitespace.
- Writes one whitespace-normalized sentence per line.

## Training Parameters

The training script (`train_lm.sh`) uses these KenLM options:

```bash
lmplz -o 3 --prune 0 0 1 < data/corpus.tok > lm.arpa
build_binary -a 256 -q 8 trie lm.arpa lm.binary
```

- **3-gram** order.
- **Trigram pruning:** unigrams and bigrams are kept in full; trigrams with count 1 are pruned.
- **Trie format** with 8-bit quantization for a compact binary file.

## Building Locally (Without Docker)

If you prefer a local build, you will need to install the system dependencies and build KenLM yourself. Docker is strongly recommended instead.

### Prerequisites

*   **Rust:** Latest stable toolchain.
*   **System Libraries:** `cmake`, `build-essential`, `libboost-all-dev`, `zlib1g-dev`, `libbz2-dev`, `liblzma-dev`.
*   **Python 3.11+** with `tqdm` (for the training script's progress display).

### Build Steps

```bash
# 1. Build KenLM
git clone https://github.com/kpu/kenlm.git
cd kenlm && mkdir -p build && cd build && cmake .. && make -j$(nproc) && cd ../..

# 2. Build the Rust inference engine
cd inference-rs && cargo build --release && cd ..

# 3. Build the Android IME WebView bundle
npm ci && npm run build
```

## Headless inference and practice server

The Rust server retains the headless inference API and the independent practice game. It does not serve IME or dictionary UI assets and has no Plover HTTP/WebSocket proxy.

| Route | Purpose |
| --- | --- |
| `GET /health` | Reports readiness after tokenizer and model loading. |
| `POST /infer` | Returns inference candidates for legacy or versioned island requests. |
| `GET /practice`, `/practice/`, `/practice.html` | Serves the separate 60-second practice game. |

```bash
docker compose build
docker compose up -d inference
docker compose ps
curl --fail http://localhost:3000/health
```

The model can take roughly 20 seconds to load. Compose reports `health: starting` during startup; wait for readiness before sending inference requests. A missing or invalid `lm.binary` prevents readiness. Check `docker compose logs --tail=100 inference`, and confirm the model is a regular readable file. `docker compose config --quiet` validates the stack. The inference service restarts unless explicitly stopped; `docker compose down` removes its containers and network.

For local serving:

```bash
./inference-rs/target/release/inference-rs --server --port 3000 --static-dir static
```

For CLI inference through Docker:

```bash
docker compose run --rm --entrypoint ./inference-rs/target/release/inference-rs inference na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

The headless API accepts the alternating legacy island array inside `{"islands":[...]}` or explicit version-2 islands:

```json
{"version":2,"islands":[{"kind":"fixed","text":"hôm nay "},{"kind":"v7","code":"tro2dde7","mode":"compositional"}]}
```

Use `mode: "dictionary"` for lexical-pair inference. Responses contain `candidates`, and may contain `invalidV7Codes` and `dictionaryBucketSizes`. `--evaluation-stdio` (or `V7_EVALUATION_PROTOCOL=ndjson-v1`) reads one legacy array or versioned request per line and writes one JSON response per line. `--model-path` selects the language model; `V7_MODEL_PATH` overrides it.

## Running Inference

### Command-Line Mode

The compiled Rust binary expects `lm.binary` in the current working directory.

#### A. Legacy Mode (Single String)

Pass a single raw V7 string. The engine decodes it as a standalone sentence.

```bash
./inference-rs/target/release/inference-rs na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7
```

**Output:**
```
Top results:
1. nay trời đẹp lắm nhưng mà khi trời mưa thì nó rất mệt
...

Inference time: Xms
```

#### B. Fixed Text Islands Mode (JSON)

Pass a JSON array of strings to interleave existing fixed text with V7 code islands. Fixed text provides context for the prediction.

**Format:** `["Fixed Text", "V7 Code", "Fixed Text", "V7 Code", ...]`
*   The array **must** start with a Fixed Text element (use an empty string `""` if there is no preceding text).
*   **Alternating structure:** Even indices are Fixed Text, odd indices are V7 Code.
*   **Context Propagation:** The engine "reads" fixed text to update its internal state, ensuring that subsequent V7 predictions are contextually appropriate. A question mark (`?`), exclamation mark (`!`), or full stop (`.`) starts a fresh sentence state, so words before it cannot influence inference after it.

**Example:**
```bash
./inference-rs/target/release/inference-rs '["hôm nay ", "tro2", " rất ", "dde7"]'
```

**Output (JSON Mode):**
Returns a JSON array of candidate lists. Each list contains the predicted text for the corresponding V7 island.

```json
[["trời","tròn",...], ["đẹp","đến",...]]
```

## V7 Input Format: Deep Dive

The V7 format is a highly compressed phonetic coding system. Unlike standard Telex, it requires precise adherence to specific mapping rules for consonants, rimes, and tones.

**Structure:** `[Consonant][RimeStart][Tone]`

### 1. Consonants
The input string must start with a valid consonant code. The parser matches the **longest** valid consonant code.

| Input Code | Vietnamese Sound | Notes |
| :--- | :--- | :--- |
| `k` | **c**, **k** | Use `k` for both `c` (ca) and `k` (ki). |
| `w` | **qu** | `w` + `y` -> `quy`, `w` + `a` -> `qua`. |
| `z` | **gi** | `z` + `a` -> `gia`. |
| `dd` | **đ** | Standard mapping. |
| `d` | **d** | Distinct from `đ`. |
| `0` | **(none)** | Use `0` for words starting with a vowel (e.g., `anh` -> `0...`). |
| `g` | **g**, **gh** | `g` handles both cases automatically. |
| `ng` | **ng**, **ngh** | `ng` handles both cases automatically. |

**Standard Consonants:** `b`, `ch`, `h`, `kh`, `l`, `m`, `n`, `nh`, `p`, `ph`, `r`, `s`, `t`, `th`, `tr`, `v`, `x`.

### 2. Rime Start
This is the **single character** that immediately follows the consonant.
*   It corresponds to the first letter of the rime, **normalized** to its base Latin vowel (removing diacritics).
*   **Normalization Rule:** `ă`, `â`, `a` -> `a`; `ê`, `e` -> `e`; `ô`, `ơ`, `o` -> `o`; `ư`, `u` -> `u`; `i`, `y` -> `i`. (Note: Both `i` and `y` are normalized to `i`).
*   **Example:** For "quyết" (qu + yết), the consonant is `w` (qu). The rime starts with `y`. Normalized: `i`. Input: `wi`.
*   **Example:** For "anh" (vowel start + anh), the consonant is `0`, rime starts with `a`. Normalized: `a`. Input: `0a`.

### 3. Tones (0-7)
Tones are represented by digits. The mapping is crucial and depends on whether the syllable ends with a **stop consonant** (`c`, `ch`, `p`, `t`).

**Open/Nasal Syllables (ending in vowel, m, n, ng, nh):**
*   `0`: **Ngang** (Level) - *ma, an*
*   `1`: **Sắc** (Acute) - *má, án*
*   `2`: **Huyền** (Grave) - *mà, àn*
*   `3`: **Hỏi** (Hook) - *mả, ản*
*   `4`: **Ngã** (Tilde) - *mã, ãn*
*   `5`: **Nặng** (Dot) - *mạ, ạn*

**Checked Syllables (Stop ending: c, ch, p, t):**
These syllables can *only* carry Sắc or Nặng tones. V7 separates them to improve prediction accuracy.
*   `6`: **Sắc** (Acute) - *mát, ách, cắp*
*   `7`: **Nặng** (Dot) - *mạt, ạch, cặp*

### Full Examples

| Word | Decomposition | V7 Code | Notes |
| :--- | :--- | :--- | :--- |
| **nay** | `n` + `ay` + Ngang | `na0` | `n` matches `n`, `a` is rime start, `0` is tone. |
| **trời** | `tr` + `ời` + Huyền | `tro2` | `tr` matches `tr`, `o` is rime start (`ơ` -> `o`), `2` is tone. |
| **đẹp** | `đ` + `ẹp` + Nặng (Stop) | `dde7` | `dd` matches `đ`, `e` is rime start, `7` is stop-tone Nặng. |
| **lắm** | `l` + `ắm` + Sắc | `la1` | `l` matches `l`, `a` is rime start (`ă` -> `a`), `1` is tone. |
| **quốc** | `qu` + `ốc` + Sắc (Stop) | `wo6` | `w` matches `qu`, `o` is rime start (`ố` -> `o`), `6` is stop-tone Sắc. |
| **anh** | `(none)` + `anh` + Ngang | `0a0` | `0` is empty consonant, `a` is rime start. |
| **nghiêng** | `ngh` + `iêng` + Ngang | `ngi0` | `ng` maps `ng/ngh`, `i` is rime start. |
| **giữa** | `gi` + `ữa` + Ngã | `zu4` | `z` matches `gi`, `u` is rime start (`ư` -> `u`), `4` is tone. |

## 60-second practice interface

The separate practice game is retained at `static/practice.html`, served at `/practice` by the Rust server and packaged by `practice-android`. It is self-contained and does not load the IME editor bundle. See [player instructions](PRACTICE_GAME.md) for the 60-second rounds, input modes, scoring, diligence, and local records.

This build space packages `static/practice.html` into a release-mode Android App Bundle (`.aab`). The Android app is intentionally small: it is a native fullscreen `WebView` shell that loads the checked-in practice page from Android assets. The build also generates the Play Console assets you need alongside the bundle.

### App Identity

| Field | Value |
| :--- | :--- |
| Package name | `com.huynhtrankhanh.v7practice` |
| App label | `V7 Practice` |
| Entry point | `MainActivity` |
| Content source | `static/practice.html` |
| Android output | Release App Bundle (`.aab`) |
| Launcher icon | Included in the bundle via `mipmap-*` resources |
| Play Console screenshots | Written to `android-artifacts/play-store/` |

### Files

| Path | Purpose |
| :--- | :--- |
| `Dockerfile.practice-android` | Container image with JDK, Gradle, Android SDK, and signing helper dependencies. |
| `docker-compose.yml` | Defines the long-running `practice-android` service used by `docker exec` / `docker compose exec`. |
| `practice-android/app/build.gradle` | Android application config, package name, release signing config, and version inputs. |
| `practice-android/app/src/main/java/.../MainActivity.java` | Fullscreen WebView wrapper that loads `file:///android_asset/practice.html`. |
| `practice-android/container/build-practice-aab` | Build entrypoint that derives signing material and runs `bundleRelease`. |
| `practice-android/container/derive-v7-practice-keystore.py` | Deterministic password-to-PKCS12 signing keystore generator. |

### Build the practice Android app

Build the image and start the service:

```sh
docker compose build practice-android
docker compose up -d practice-android
```

Create a signed release bundle:

```sh
docker compose exec practice-android build-practice-aab "1.0.0"
```

The command can also be run with direct Docker exec:

```sh
docker exec -it v7-practice-android-1 build-practice-aab "1.0.0"
```

Artifacts are written through the bind mount to:

```text
android-artifacts/
```

For version `1.0.0`, the expected outputs are:

```text
android-artifacts/v7-practice-1.0.0.aab
android-artifacts/v7-practice-1.0.0.aab.sha256
android-artifacts/play-store/app-icon-512.png
android-artifacts/play-store/phone-portrait-1080x1920.png
android-artifacts/play-store/phone-landscape-1920x1080.png
android-artifacts/play-store/tablet-portrait-1440x2560.png
android-artifacts/play-store/tablet-landscape-2560x1440.png
```

### Inputs

The build command accepts:

```text
build-practice-aab <versionName> [versionCode]
```

| Argument | Required | Meaning |
| :--- | :--- | :--- |
| `versionName` | Yes | Human-readable Android version name, for example `1.0.0`. |
| `versionCode` | No | Integer Android version code. If omitted, digits are derived from `versionName`; if no digits exist, `1` is used. |

For Google Play uploads, sign with the upload key registered in Play Console (`Setup > App integrity > Upload key certificate`). Provide that keystore with `SIGNING_STORE_FILE`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`, and `SIGNING_KEY_PASSWORD`; the build script now preserves those values instead of replacing them with a derived key. If you do not provide `SIGNING_STORE_FILE`, the signing password is prompted from stdin with `*` masking when run interactively. For automation with the derived fallback, provide `V7_SIGNING_PASSWORD` in the environment instead of passing the secret as a command-line argument.

Example with explicit version code:

```sh
docker compose exec practice-android build-practice-aab "1.0.0" 100
```

The same values can be supplied via environment variables:

```sh
docker compose exec \
  -e SIGNING_STORE_FILE="/workspace/secrets/play-upload.jks" \
  -e SIGNING_STORE_PASSWORD="your keystore password" \
  -e SIGNING_KEY_ALIAS="your upload key alias" \
  -e SIGNING_KEY_PASSWORD="your key password" \
  -e V7_VERSION="1.0.0" \
  -e V7_VERSION_CODE="100" \
  practice-android build-practice-aab
```

### Signing Model

The build does not store a signing key in the repository. For Play uploads, provide the Play Console upload keystore through the `SIGNING_*` environment variables. If no keystore is provided, `derive-v7-practice-keystore.py` derives a deterministic 4096-bit RSA private key from the supplied password and writes a temporary PKCS12 keystore inside the container. Gradle uses the selected keystore for release signing.

Important consequences:

*   The `.aab` must be signed with the upload certificate shown in Play Console. A different key can be cryptographically valid but still rejected by Google Play.
*   The build runs `jarsigner -verify -verbose` after `bundleRelease` and writes the upload certificate SHA-1/SHA-256 fingerprints to `android-artifacts/v7-practice-<version>.upload-certificate.txt` so the pipeline can compare them with Play Console.
*   In derived-key fallback mode, the same password recreates the same 4096-bit RSA signing key and certificate (valid from 2024-01-01 through 2054-01-01), so future versions can be signed consistently only if that derived certificate has been registered as the Play upload key.
*   Losing or changing the password changes the signing key and produces bundles that are not compatible as updates to an app signed with the previous password.
*   The derived keystore is temporary container build material. It is not copied to `android-artifacts/` and should not be committed.

### Content Packaging

`practice-android/app/build.gradle` copies `../static/practice.html` into `app/src/main/assets` before Android builds. The WebView loads that local asset with:

```text
file:///android_asset/practice.html
```

Rebuilding the bundle after editing `static/practice.html` is enough to package the latest practice page.

The build entrypoint also generates the launcher icon resources consumed by the bundle and the Play Store screenshots used for submission.

### Verification

A successful build ends with Gradle's `bundleRelease` task, a `jarsigner` verification, and the bundle path plus SHA-256 checksum, for example:

```text
BUILD SUCCESSFUL
<sha256>  /workspace/artifacts/v7-practice-1.0.0.aab
AAB: /workspace/artifacts/v7-practice-1.0.0.aab
```

## Development and validation

Install JavaScript dependencies with `npm ci`. `npm run build` compiles `src/ime.ts` into `static/script.js`; the Android Gradle build packages only the composition and dictionary assets. Browser automation supplies mock native bridges to exercise the APK UI; it is a test harness, not a supported browser editor.

```bash
npm run build
npx tsc --noEmit
npm run test:unit -- --runInBand tests/editorCore.test.ts tests/undoManager.test.ts tests/slottedClipboard.test.ts tests/imeInitialization.test.ts tests/practiceGame.test.ts
npm run test:android-ime
npm run test:clipboard-slots
npm run test:dictionary-layout
npm run test:practice-focus
npm run test:practice-zoom
```

`npm run test:e2e` runs the Android bridge, clipboard, dictionary layout, practice focus, and practice zoom checks together. `npm run test:android-stripped-plover` additionally exercises the generated bundled runtime in isolated and non-isolated WebView configurations; build its generated Android assets first. Native Android unit tests run through `gradle -p ime-android testDebugUnitTest` after installing the Android build dependencies.

After building the host engine with `cargo build --manifest-path inference-rs/Cargo.toml`,
run `npm run test:inference-api` with a local `lm.binary` to verify inference,
practice routes, and the absence of editor/proxy routes. `V7_INFERENCE_BINARY`
and `V7_TEST_MODEL_PATH` select another binary or model. Rust unit tests run with
`cargo test --manifest-path inference-rs/Cargo.toml --locked`.

The repository also retains historical evaluator unit tests whose implementation directories are absent in this checkout; `npm test` and the aggregate test typecheck may fail on those missing imports. The explicit current-client suites above do not depend on those unshipped subsystems.

KenLM's host build needs Boost program-options, system, thread, and unit-test development packages, plus zlib, bzip2, and lzma. Docker installs these. Set `KENLM_ROOT` when KenLM is outside `./kenlm`; its host build must contain `build/lib/libkenlm.a` and `build/lib/libkenlm_util.a`. Native and Docker inference tests need a trained model; Android additionally needs the selected document grant.

## License

Original V7 source files in this repository are licensed under the
[0BSD License](LICENSE).

The bundled Android distribution is a combined work that includes Stripped
Plover. The APK is conveyed under GPL-3.0-or-later and contains its complete
Corresponding Source as `v7-ime-source.zip`, exportable from **V7 IME
settings → Save Corresponding Source**. This distribution-level GPL notice
does not replace the 0BSD license on original V7 source files. Stripped Plover
and other third-party components retain their respective copyright and license
notices. See [Android architecture](#architecture) and [signed release pipeline](#signed-release-pipeline) above for distribution and source details.

## Acknowledgments

This project was originally inspired by the [v7](https://github.com/ducngg/v7) repository. While the current codebase represents a significant divergence in implementation and approach, we acknowledge the instrumental role of the original project in the development of this engine. See `ACKNOWLEDGMENTS.md` for more details and the original license.
