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
forms, validation, and search/edit state. Its `<input type="file">` uses
WebView's standard file-chooser callback, and the selected filename or MIME
type chooses JSON versus Python import semantics. On Android, native code
retains the selected document URI and streams it directly into private staging;
dictionary contents never cross `@JavascriptInterface` as a large string. The
browser-only UI still uses `File.text()` or a `FileReader` fallback.

The separate `AndroidDictionary` bridge is intentionally small:

- `requestPlover` carries RPC to the bundled process-wide Stripped Plover
  runtime WebView;
- `saveDictionaryFile` opens Android's Storage Access Framework destination
  picker for exported UTF-8 JSON or Python;
- `enqueueSelectedDictionaryImport` stages the natively selected document and schedules a durable,
  sandboxed background import;
- `getDictionaryImportState` lets a newly opened manager resume the latest
  job's progress display;
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

## Background imports

Android imports do not depend on `DictionaryManagementActivity` remaining
open. After the WebUI submits the import metadata, the native bridge streams
the selected document to a private staging file and appends a one-time
WorkManager job. WorkManager
keeps the import alive if the manager closes and displays a determinate
**Importing dictionary** foreground notification while it runs.

The worker pauses the translation runtime and passes source into AndroidX
JavaScriptEngine's out-of-process `JavaScriptSandbox`. The generated import
bundle uses the pinned Stripped Plover normalizer and drains JSON entries in
bounded chunks into one native SQLite transaction. The runtime restarts after
commit, so closing the activity cannot detach or throttle the import engine and
live clients cannot retain a stale dictionary cache.

The IME visibly reports **Stripped Plover (PAUSED)** for the full database
handoff. Plover-bound strokes are ignored while paused, with guards on both
the WebUI and native RPC sides, rather than being buffered and translated
after the import.

Python source is persisted as a read-only dictionary and then loaded by the
regular Stripped Plover CPython/Wasm sandbox. AndroidX `JavaScriptIsolate` has no
browser Worker or service-worker APIs, so it cannot safely impersonate that
runtime. It is used for durable source transfer and import planning, never as a
less-capable replacement Python host. Imports are serialized and the staging
file is removed on every terminal path.

The manager polls a small native state record while visible. It shows queued,
running, successful, or failed state inline, including the phase, entry counts
where available, and percentage. Reopening reconnects to the latest import
state and refreshes dictionaries after success.

## Scrolling

The Settings-hosted dictionary manager uses the shared dialog markup as a
full-viewport, non-modal page. Its content area is the single primary vertical
scroll container; dictionary lists and lookup results expand into that page
instead of creating competing nested scrollers. This keeps touch scrolling
reliable in Android WebView when a panel exceeds the available height. The
ordinary browser UI still uses the bounded modal dialog and its compact inner
result regions.

At phone widths, the full-screen manager also keeps its header and three tabs
sticky, honors display-cutout safe areas, uses 44 dp-equivalent touch targets,
shows persistent labels above every field, and collapses search/edit forms to
a single column. Dictionary actions remain a compact two-column row so long
names and status badges do not force horizontal scrolling.

The runtime WebView, Node compatibility audit, native SQLite bridge, and
source-bundle licensing boundary are documented in
[Bundled Stripped Plover runtime](bundled-stripped-plover.md).
