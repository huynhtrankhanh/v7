package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;

import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

final class SandboxedDictionaryImporter {
    private static final String SANDBOX_ASSET =
            "stripped-plover-import-sandbox.js";
    private static final int CHUNK_SIZE = 200;
    private static final long SANDBOX_TIMEOUT_SECONDS = 45L;

    interface ProgressCallback {
        void onProgress(String phase, int current, int total, int percent)
                throws Exception;
    }

    static final class ImportResult {
        final int entries;
        final boolean python;

        ImportResult(int entries, boolean python) {
            this.entries = entries;
            this.python = python;
        }
    }

    private SandboxedDictionaryImporter() {
    }

    static ImportResult importSource(
            Context context,
            String name,
            String type,
            byte[] source,
            boolean merge,
            ProgressCallback progress) throws Exception {
        validateRequest(name, type, source, merge);
        progress.onProgress("Starting Android JavaScript sandbox", 0, -1, 8);
        JavaScriptSandbox sandbox = ApplicationJavaScriptSandbox.get(
                context, SANDBOX_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        {
            requireFeature(
                    sandbox,
                    JavaScriptSandbox.JS_FEATURE_PROMISE_RETURN,
                    "promise results"
            );
            requireFeature(
                    sandbox,
                    JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER,
                    "large dictionary transfer"
            );
            try (JavaScriptIsolate isolate = sandbox.createIsolate()) {
                String runtime = readAsset(context, SANDBOX_ASSET);
                isolate.evaluateJavaScriptAsync(runtime).get(
                        SANDBOX_TIMEOUT_SECONDS,
                        TimeUnit.SECONDS
                );

                String dataName = "dictionary-" + UUID.randomUUID();
                isolate.provideNamedData(dataName, source);
                String metadataJson = isolate.evaluateJavaScriptAsync(
                        "V7DictionaryImportSandbox.initialize("
                                + JSONObject.quote(dataName) + ","
                                + JSONObject.quote(type) + ")"
                ).get(SANDBOX_TIMEOUT_SECONDS, TimeUnit.SECONDS);
                JSONObject metadata = new JSONObject(metadataJson);
                int total = metadata.getInt("total");
                progress.onProgress(
                        type.equals("json")
                                ? "Validated JSON dictionary"
                                : "Validated Python dictionary source",
                        0,
                        total,
                        18
                );

                if (type.equals("python")) {
                    persistPython(context, name, source);
                    progress.onProgress(
                            "Stored Python dictionary for CPython/Wasm",
                            1,
                            1,
                            92
                    );
                    return new ImportResult(-1, true);
                }
                return persistJson(
                        context,
                        isolate,
                        name,
                        merge,
                        total,
                        progress
                );
            }
        }
    }

    private static ImportResult persistJson(
            Context context,
            JavaScriptIsolate isolate,
            String name,
            boolean merge,
            int total,
            ProgressCallback progress) throws Exception {
        SQLiteDatabase database = openDatabase(context);
        database.beginTransaction();
        try {
            ExistingDictionary existing = findDictionary(database, name);
            if (existing != null && !canImportJsonOver(existing.type)) {
                throw new IllegalStateException(
                        "Dictionary does not expose concrete entries: " + name
                );
            }
            if (existing == null) {
                database.execSQL(
                        "INSERT INTO dictionaries "
                                + "(name, type, enabled, priority, python_code) "
                                + "VALUES (?, 'json', 1, ?, NULL)",
                        new Object[]{name, nextPriority(database)}
                );
            }
            if (!merge) {
                database.delete("entries", "dictionary = ?", new String[]{name});
            }

            try (SQLiteStatement insert = database.compileStatement(
                    "INSERT OR REPLACE INTO entries "
                            + "(dictionary, stroke, translation) VALUES (?, ?, ?)"
            )) {
                int processed = 0;
                boolean done = false;
                while (!done) {
                    String chunkJson = isolate.evaluateJavaScriptAsync(
                            "V7DictionaryImportSandbox.nextChunk(" + CHUNK_SIZE + ")"
                    ).get(SANDBOX_TIMEOUT_SECONDS, TimeUnit.SECONDS);
                    JSONObject chunk = new JSONObject(chunkJson);
                    JSONArray entries = chunk.getJSONArray("entries");
                    for (int index = 0; index < entries.length(); index++) {
                        JSONArray entry = entries.getJSONArray(index);
                        insert.clearBindings();
                        insert.bindString(1, name);
                        insert.bindString(2, entry.getString(0));
                        insert.bindString(3, entry.getString(1));
                        insert.executeInsert();
                    }
                    processed = chunk.getInt("processed");
                    done = chunk.getBoolean("done");
                    int percent = total == 0
                            ? 90
                            : 20 + (int) Math.floor(70.0 * processed / total);
                    progress.onProgress(
                            "Importing entries",
                            processed,
                            total,
                            percent
                    );
                }
            }
            database.setTransactionSuccessful();
            return new ImportResult(countEntries(database, name), false);
        } finally {
            database.endTransaction();
            database.close();
        }
    }

    private static void persistPython(
            Context context,
            String name,
            byte[] source) {
        SQLiteDatabase database = openDatabase(context);
        database.beginTransaction();
        try {
            ExistingDictionary existing = findDictionary(database, name);
            int priority = existing == null
                    ? nextPriority(database)
                    : existing.priority;
            database.execSQL(
                    "INSERT OR REPLACE INTO dictionaries "
                            + "(name, type, enabled, priority, python_code) "
                            + "VALUES (?, 'python', 1, ?, ?)",
                    new Object[]{
                            name,
                            priority,
                            new String(source, StandardCharsets.UTF_8)
                    }
            );
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
            database.close();
        }
    }

    private static SQLiteDatabase openDatabase(Context context) {
        java.io.File path = context.getDatabasePath(
                NativeStrippedPloverSqlite.DATABASE_NAME
        );
        java.io.File parent = path.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IllegalStateException("Could not create database directory");
        }
        SQLiteDatabase database = SQLiteDatabase.openOrCreateDatabase(path, null);
        database.setForeignKeyConstraintsEnabled(true);
        database.execSQL(
                "CREATE TABLE IF NOT EXISTS dictionaries ("
                        + "name TEXT PRIMARY KEY, type TEXT NOT NULL, "
                        + "enabled BOOLEAN DEFAULT 1, "
                        + "priority INTEGER, python_code TEXT)"
        );
        database.execSQL(
                "CREATE TABLE IF NOT EXISTS entries ("
                        + "dictionary TEXT NOT NULL, stroke TEXT NOT NULL, "
                        + "translation TEXT NOT NULL, "
                        + "PRIMARY KEY (dictionary, stroke), "
                        + "FOREIGN KEY (dictionary) REFERENCES dictionaries(name) "
                        + "ON DELETE CASCADE)"
        );
        database.execSQL(
                "CREATE INDEX IF NOT EXISTS idx_entries_dictionary "
                        + "ON entries(dictionary)"
        );
        return database;
    }

    private static ExistingDictionary findDictionary(
            SQLiteDatabase database,
            String name) {
        try (Cursor cursor = database.rawQuery(
                "SELECT type, priority FROM dictionaries WHERE name = ?",
                new String[]{name}
        )) {
            if (!cursor.moveToFirst()) return null;
            return new ExistingDictionary(
                    cursor.getString(0),
                    cursor.isNull(1) ? 0 : cursor.getInt(1)
            );
        }
    }

    private static int nextPriority(SQLiteDatabase database) {
        try (Cursor cursor = database.rawQuery(
                "SELECT COALESCE(MAX(priority), 0) + 1 FROM dictionaries",
                null
        )) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 1;
        }
    }

    static boolean canImportJsonOver(String existingType) {
        return "json".equals(existingType);
    }

    private static int countEntries(SQLiteDatabase database, String name) {
        try (Cursor cursor = database.rawQuery(
                "SELECT COUNT(*) FROM entries WHERE dictionary = ?",
                new String[]{name}
        )) {
            return cursor.moveToFirst() ? cursor.getInt(0) : 0;
        }
    }

    private static void validateRequest(
            String name,
            String type,
            byte[] source,
            boolean merge) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("Dictionary name is required");
        }
        if (!"json".equals(type) && !"python".equals(type)) {
            throw new IllegalArgumentException(
                    "Dictionary type must be json or python"
            );
        }
        if (source == null || source.length == 0) {
            throw new IllegalArgumentException("Dictionary source is empty");
        }
        if (merge && "python".equals(type)) {
            throw new IllegalArgumentException(
                    "Merge is not supported for Python dictionaries"
            );
        }
    }

    private static void requireFeature(
            JavaScriptSandbox sandbox,
            String feature,
            String description) {
        if (!sandbox.isFeatureSupported(feature)) {
            throw new IllegalStateException(
                    "Android System WebView does not support JavaScript sandbox "
                            + description
            );
        }
    }

    private static String readAsset(Context context, String name)
            throws IOException {
        try (InputStream input = context.getAssets().open(name);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static final class ExistingDictionary {
        final String type;
        final int priority;

        ExistingDictionary(String type, int priority) {
            this.type = type;
            this.priority = priority;
        }
    }
}
