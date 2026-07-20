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
`<input type="file">` uses WebView's standard file-chooser callback. The
selected filename or MIME type chooses JSON versus Python import semantics,
and the file is read with `File.text()` or a `FileReader` fallback for older
WebViews.

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
- open a dictionary's entries directly from its dictionary card;
- import and export JSON or Python dictionaries;
- enumerate, search, add, update, and remove entries;
- stroke lookup and reverse translation lookup.

All file access goes through system document pickers; no broad filesystem
permission is requested. The Android import picker intentionally does not
filter by MIME type because document providers report Python and JSON files
under inconsistent types. The shared web form identifies the supported
`.py` and `.json` formats instead.

## Scrolling

The Settings-hosted dictionary manager uses the shared dialog markup as a
full-viewport, non-modal page. Its content area is the single primary vertical
scroll container; dictionary lists and lookup results expand into that page
instead of creating competing nested scrollers. This keeps touch scrolling
reliable in Android WebView when a panel exceeds the available height. The
ordinary browser UI still uses the bounded modal dialog and its compact inner
result regions.

The runtime WebView, Node compatibility audit, native SQLite bridge, and
source-bundle licensing boundary are documented in
[Bundled Stripped Plover runtime](bundled-stripped-plover.md).

## Upload diagnostics

The **Diagnostics** tab in the Android dictionary manager retains the most
recent 64 KiB of timestamped request history across app restarts. It includes
the Android, app, and WebView versions and has **Copy**, **Clear**, and
**Refresh** controls. Dictionary source and entry contents are not recorded.

Android also mirrors each event to the system log when developer access is
available:

```sh
adb logcat -s V7Dictionary:I V7PloverRuntime:I
```

For a healthy import, the request advances through `file-selected`,
`read-start`, `read-complete`, `management-dispatch`, `queued`, `dispatch`,
`runtime-queued`, `runtime-start`, `runtime-complete`, `complete`,
`management-complete`, and `ui-complete`. The elapsed times identify whether a
delay is reading the selected document, crossing the native bridge, inside
Python dictionary initialization, or returning the result to the management
page.
