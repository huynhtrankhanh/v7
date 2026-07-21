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

There are three different WebViews with disjoint jobs:

| WebView | Owner | Native surface |
| --- | --- | --- |
| IME interface | `V7ImeService` | composing text, inference, height, key mode, and Stripped Plover RPC client |
| Dictionary manager | `DictionaryManagementActivity` | Stripped Plover RPC client plus Android document import/export |
| Import worker | `DictionaryImportWorker` | durable foreground work plus RPC into the shared engine |
| Stripped Plover engine | process-wide `BundledStrippedPloverRuntime` | runtime completion callbacks and native SQLite only |

The engine WebView is a process-wide, non-visual WebView. Neither interface
WebView contains the engine, and the engine WebView has no IME or dictionary
editing bridge. Both interface clients submit the existing JSON RPC protocol
to the same serialized runtime queue, so translation and dictionary editing
share one engine and database.

Dictionary imports use that separation to outlive the management screen. A
WorkManager foreground task owns the loading notification and staged source,
while the actual source parsing and upstream import run inside the same
sandboxed engine WebView used for translation. The worker never evaluates
dictionary code itself and never exposes Android APIs to dictionary source.

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

The STDIO entry's `node:readline`, `process.argv`, stdin, stdout, and exit APIs
are intentionally absent. Android supplies a small browser RPC entry instead.
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

`npm run test:android-stripped-plover` serves the generated runtime, injects a
narrow test SQLite bridge, and verifies that the real bundled engine initializes
its schema, answers a dictionary-state RPC, and imports and translates with a
roughly 43 KB Python dictionary in Puppeteer. It runs once with cross-origin
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
- [SQLite on Android](https://developer.android.com/training/data-storage/sqlite)
  documents the framework database API used for persistence.
