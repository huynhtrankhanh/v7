# Stripped Plover dictionary management on Android

Android reuses the browser WebUI's existing **Dictionary Management** surface.
The dialog markup lives in `src/ploverDictionaryUi.ts`, its styling lives in
`static/plover-dictionary.css`, and the same tabs and actions are mounted on
both platforms.

## Settings activity, not the IME

Dictionary editing never runs inside `V7ImeService` or its input view. Text
fields inside an IME create a nested editing context and make focus and
soft-keyboard behavior unreliable.

To manage dictionaries:

1. open the V7 IME launcher/settings screen;
2. tap **Manage Stripped Plover dictionaries**;
3. use the full-screen management activity.

The activity loads the dedicated `static/dictionary.html` page. That page has
no inference, PREEDIT, keyboard-mode, or input-method controls. Conversely, the
normal IME page does not mount the dictionary dialog.

## Web and native responsibilities

The management WebView uses standard web capabilities for dialog rendering,
forms, validation, search/edit state, and file import. Its
`<input type="file">` uses WebView's standard file-chooser callback and
`File.text()` reads the selected JSON or Python file.

The separate `AndroidDictionary` bridge is intentionally small:

- `requestPlover` carries RPC to the bundled process-wide Stripped Plover
  runtime WebView;
- `saveDictionaryFile` opens Android's Storage Access Framework destination
  picker for exported UTF-8 JSON or Python;
- `close` finishes the management activity;
- `hasPloverConfiguration` reports the always-present bundled runtime.

It does not expose inference, composing text, keyboard height, steno mode, or
input-method switching.

## Available operations

Android uses the same controller and Stripped Plover RPC methods as the browser
surface:

- refresh, enable/disable, reprioritize, solo, rename, and remove dictionaries;
- import and export JSON or Python dictionaries;
- enumerate, search, add, update, and remove entries;
- stroke lookup and reverse translation lookup.

All file access goes through system document pickers; no broad filesystem
permission is requested.

The runtime WebView, Node compatibility audit, native SQLite bridge, and
source-bundle licensing boundary are documented in
[Bundled Stripped Plover runtime](bundled-stripped-plover.md).
