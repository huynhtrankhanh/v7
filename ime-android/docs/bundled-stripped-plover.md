# Bundled Stripped Plover runtime

The Android APK includes Stripped Plover and runs it locally. It does not
require Node.js, a TCP service, or a configured host.

## Source acquisition and artifacts

Stripped Plover is pinned by `STRIPPED_PLOVER_REVISION`. The Gradle build
checks out that exact revision into `app/build/stripped-plover`, an ignored
generated directory. Its source is therefore not vendored into the V7 source
tree.

The checkout feeds two distinct artifacts:

- the APK receives a browser bundle, WebAssembly files, Python standard-library
  archives, and worker scripts under generated Android assets;
- `v7-ime-source.zip` receives the pristine pinned checkout at
  `third_party/stripped-plover`, including its upstream license and build
  metadata.

The archive records the V7, KenLM, and Stripped Plover revisions in
`BUILD-SOURCE.md`.

## Runtime separation

The interactive/runtime surfaces and background importer have disjoint jobs:

| Surface | Owner | Native surface |
| --- | --- | --- |
| IME interface | `V7ImeService` | composing text, inference, height, key mode, and Stripped Plover RPC client |
| Dictionary manager | `DictionaryManagementActivity` | Stripped Plover RPC client plus Android document import/export |
| Import worker | `DictionaryImportWorker` | durable foreground work plus an AndroidX `JavaScriptSandbox` isolate and native SQLite transaction |
| Stripped Plover engine | process-wide `BundledStrippedPloverRuntime` | runtime completion callbacks and native SQLite only |

The engine WebView is a process-wide, non-visual WebView. Neither interface
WebView contains the engine, and the engine WebView has no IME or dictionary
editing bridge. Both interface clients submit the existing JSON RPC protocol
to the same serialized runtime queue, so translation and dictionary editing
share one engine and database.

The pinned engine also emits the upstream asynchronous `plover:lookup`,
`plover:add_translation`, and `plover:configure` events. The CLI normally
writes them between STDIO protocol responses. Android replaces that event sink
with a separate native callback while leaving request/response completion
unchanged. `V7ImeService` routes lookup and add-translation to native dialog
activities and configure directly to `SettingsActivity`; unrelated events are
not treated as UI commands. Command dialogs run in their own excluded,
no-history task with empty affinity, so an existing V7 Settings task is never
pulled underneath the modal. The transient dialog appears over the application
that currently owns the editor and disappears completely when closed.

Hardware-keyboard users can cycle every enabled command control with Tab and
Shift-Tab, including populated selectable results/errors and wraparound, while
disabled controls are skipped. The pinned command protocol supplies one
untyped argument. Because values such as `HAT` can be either ordinary text or
a valid outline, V7 does not guess: all command arguments populate Translation,
while an empty argument starts in Stroke. Focus starts in that initial editor.
Focused controls are scrolled into view,
Enter retains the existing submit
behavior, and Escape closes the dialog.
These rules are implemented natively so they remain consistent when the soft
keyboard is hidden. Writable dictionaries are visible numbered radio choices;
bare number keys select one while the choice list has focus, and Alt plus that
number selects it from anywhere in the form.

Lookup uses the runtime's bounded, paginated exact entry search and displays
each supplying dictionary. Translation lookup does not request sentence
capitalization: non-ASCII text is searched as entered because the pinned
runtime does not expose Unicode case-folded indexed search. Editing either
field cancels ownership of the current page chain; an obsolete response cannot
schedule another page or replace the result pane.

Caps Lock follows the physical keyboard's current lock state throughout these
flows. Candidate selection preserves the casing assigned when each piece of
output was produced; the lock state of the later selection action does not
retroactively uppercase an existing candidate or older fixed text.

Dictionary imports use that separation to outlive the management screen. A
WorkManager foreground task owns the loading notification and staged source.
It pauses the WebView engine, creates AndroidX JavaScriptEngine's official
out-of-process `JavaScriptSandbox`, and passes the source with
`provideNamedData`. A generated bundle uses the pinned Stripped Plover stroke
implementation to parse, validate, normalize, and drain JSON entries in
bounded chunks. Native code applies those chunks in one SQLite transaction,
then restarts the engine so no client retains a stale dictionary cache.
The source reaches staging through Android's document URI, not a JavaScript
bridge string, so large imports do not depend on WebView/Binder transaction
limits.

This distinction matters: an unattached WebView is not a durable background
JavaScript host. Android may throttle its renderer and workers when the
settings activity closes. `JavaScriptSandbox` is explicitly designed for
non-interactive evaluation from a Service or WorkManager task and runs in a
separate process without a DOM or Android JavaScript interface.

Python dictionaries cross the same sandbox transfer and are stored as
read-only source in the native transaction. They are not executed in the
AndroidX isolate. Stripped Plover's CPython/Wasm runtime needs browser Worker
and service-worker I/O, which `JavaScriptIsolate` intentionally does not
provide. After the transaction, the normal isolated engine WebView starts and
CPython/Wasm validates and executes the stored source. Arbitrary Python never
receives an Android bridge or runs in the WorkManager process.

The runtime loads app assets through
`https://appassets.androidplatform.net`, not `file://`. Responses carry
same-origin isolation headers so browser `Worker`, `SharedArrayBuffer`, Web
Crypto, `fetch`, and WebAssembly capabilities remain available. Python
dictionaries use Stripped Plover's vendored browser build of `python-wasm`;
they do not gain filesystem or process access through an Android bridge.

Some WebView/device combinations do not expose a cross-origin-isolated
environment even when those headers are present. The bundled runtime therefore
also supports python-wasm's service-worker I/O mode. Its worker is emitted at
the root of the `/assets/` scope, takes control before the engine reports
itself ready, and handles I/O under `/assets/python-wasm-sw/`. This startup
handshake avoids both an out-of-scope request and the runtime-page reload that
would otherwise abandon an in-flight dictionary import. Android's process-wide
service-worker request client uses the same `WebViewAssetLoader`, so the worker
script continues to resolve from the APK rather than falling through to the
network. Startup also removes the narrower, broken worker registration left by
older app builds.

Unexpected runtime navigations fail active requests immediately instead of
leaving them to time out.

## Import progress and failure semantics

The worker publishes the same structured state to WorkManager, a determinate
foreground notification, and the dictionary manager's reconnectable state
record. State includes `phase`, `current`, `total`, and `percent`. JSON progress
counts entry chunks. Python progress reports source validation, persistence,
and engine restart phases because a dynamic Python dictionary need not expose
an enumerable entry count. A failure rolls back the SQLite transaction,
records the terminal error, resumes the engine, and deletes the staged source.

While the worker owns the database, the IME changes its runtime label to
**Stripped Plover (PAUSED)** and uses the error-state color. Both the WebUI and
the native RPC boundary discard translation strokes during that interval, so
an event racing with the pause cannot be queued and replayed against the
restarted engine. Normal translation resumes only after the transaction has
finished and the runtime has been released.

## Node compatibility audit

Every Android build copies the pinned production TypeScript graph to an
ignored typecheck directory. The build:

1. walks imports reachable from `src/engine.ts`, excluding the CLI/STDIO entry;
2. uses the TypeScript compiler in strict, no-emit mode against the Android
   compatibility types;
3. asserts the exact direct Node surface currently used by that graph; and
4. fails with an instruction to audit and extend the polyfills if upstream
   adds another Node module or global.

At the pinned revision, the direct engine surface is:

- `node:sqlite`: `DatabaseSync`, `prepare`, `exec`, and statement
  `all`/`get`/`iterate`/`run`;
- `node:crypto`: `randomBytes`;
- `node:fs`: read-only `readFileSync` access to the bundled orthography word
  list;
- `Buffer.alloc` and `writeBigUInt64LE`; and
- `process.platform`.

The pinned Stripped Plover revision also makes Python dictionaries
filesystem-hermetic: the CPython/Wasm adapter omits host filesystem and stdio
mounts while retaining its private in-memory standard-library filesystem.

The STDIO entry's `node:readline`, `process.argv`, stdin, stdout, and exit APIs
are intentionally absent. Android supplies a small browser RPC entry and
explicit asynchronous event sink instead.
Web Crypto implements secure random bytes. Maintained browser packages provide
the Buffer/process and Node-core compatibility required inside the upstream
browser WebAssembly dependencies.

## Native SQLite

`AndroidStrippedPloverSqlite` is the only persistence bridge. The JavaScript
`DatabaseSync` compatibility class delegates synchronously to the app-private
`android.database.sqlite.SQLiteDatabase` and exposes no Stripped Plover RPC or
IME methods.

Android framework SQLite does not consistently include the upstream
FTS5 `trigram` tokenizer. The compatibility layer therefore:

- keeps the authoritative `dictionaries` and `entries` tables, constraints,
  indexes, and transactions in native SQLite;
- omits only the derived `entries_fts` table and its triggers; and
- rewrites the one FTS-backed substring query to an escaped,
  case-insensitive `LIKE` query against `entries`.

Other enumeration, lookup, prefix search, mutation, priority, and transaction
queries execute unchanged. Host-side tests cover SQL-script splitting,
multi-statement trigger boundaries, FTS setup filtering, parameter escaping,
and query rewriting.

## Licensing boundary

Fetching Stripped Plover does not alter the V7 repository license or relicense
V7 intellectual property. V7 source files remain 0BSD. Stripped Plover and all
other third-party files retain their own upstream licenses.

The shared V7 dictionary UI, CSS, Android bridge, WorkManager orchestration,
and progress protocol are independently written interoperability code; they do
not copy Stripped Plover implementation. The Android build imports the pinned
upstream `stroke.ts` only into the generated
`stripped-plover-import-sandbox.js` artifact. That generated artifact stays on
the Stripped Plover/GPL side of the source archive together with the existing
engine runtime. This records the concrete source boundary without claiming
that interoperability alone determines whether a particular distribution is a
combined work.

The bundled Android distribution, including the APK and Stripped Plover
runtime, is conveyed as a combined work under GPL-3.0-or-later. The generated
`v7-ime-source.zip` is the complete Corresponding Source for that APK and is
bundled as an Android asset. Settings exports the exact bundled archive.

The archive's `ANDROID-DISTRIBUTION-LICENSE.txt` documents this
distribution-level GPL boundary. It does not replace the licenses of
constituent source files: original V7 files remain separately available under
0BSD, and Stripped Plover's own GPL-2.0-or-later text is included unchanged
inside its source directory.

## Verification

`npm run test:android-stripped-plover` serves the generated runtime and import
sandbox bundle, injects a
narrow test SQLite bridge, and verifies that the real bundled engine initializes
its schema, answers a dictionary-state RPC, and imports and translates with a
roughly 43 KB Python dictionary in Puppeteer. It also exercises the AndroidX
named-data contract and chunked JSON normalization. The runtime test runs once with cross-origin
isolation and once without it, exercising both atomics and service-worker I/O.
The test uses two independently puppeteered pages and Android's `/assets/` URL
layout, so the management/runtime WebView boundary and deployed worker,
WebAssembly, Python archive, and service-worker paths are covered. The Gradle
unit suite tests the native compatibility and database-transfer policies. An
APK build then verifies asset merging and inclusion of the generated source
ZIP.

Platform references:

- [WebViewAssetLoader](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader)
  documents serving APK assets through a web-compatible HTTPS origin.
- [JavaScriptEngine](https://developer.android.com/develop/ui/views/layout/webapps/jsengine)
  documents out-of-process evaluation from WorkManager and large named-data
  transfer.
- [SQLite on Android](https://developer.android.com/training/data-storage/sqlite)
  documents the framework database API used for persistence.
