# App-data import and export

The V7 IME Settings screen can export or import all data owned by the bundled
Stripped Plover engine. The transfer artifact is an ordinary SQLite 3 database
named `v7-ime-app-data.sqlite3` by default.

## Included data

The database is the engine's complete persistent state. An export includes:

- JSON and Python dictionaries;
- every dictionary entry;
- dictionary names, types, enabled/read-only states, and priority order.

The selected `lm.binary` language model is not included. V7 does not copy that
file into app-private storage; Android retains permission to the external
document selected by the user. Choose the model again on a new device.

## Export

Tap **Export all app data** and choose a destination through Android's Storage
Access Framework. Before copying, V7 pauses the shared engine and closes its
native SQLite connection. Closing the connection checkpoints SQLite state, so
the exported file is self-contained and does not depend on `-wal` or `-shm`
sidecar files. The runtime restarts after the copy completes.

## Import

Tap **Import all app data**, select a prior SQLite export, and confirm the
replacement warning. Import replaces the current database rather than merging
it. Export the current data first if it may be needed later.

Before touching the active database, V7 copies the selected document to a
private staging file and verifies:

1. the SQLite 3 file header;
2. SQLite's `quick_check` integrity result; and
3. that the Stripped Plover tables are either both present or both absent for
   a pristine database.

V7 then pauses the engine, closes SQLite, renames the current database to a
temporary backup, and atomically installs the staged file. If installation
fails, the previous database is restored. Obsolete WAL/shared-memory sidecars
are removed before the replacement, and the runtime reopens the imported data
afterward.

All source and destination access uses Android's document picker. The app does
not request broad filesystem permission.
