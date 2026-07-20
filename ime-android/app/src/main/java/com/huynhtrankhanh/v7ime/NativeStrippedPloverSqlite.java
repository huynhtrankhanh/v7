package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class NativeStrippedPloverSqlite {
    private static final String DATABASE_NAME = "stripped-plover.sqlite";

    private final Context context;
    private SQLiteDatabase database;
    private boolean transactionActive;

    NativeStrippedPloverSqlite(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public synchronized void open(String ignoredNodePath) {
        getDatabase();
    }

    @JavascriptInterface
    public synchronized void exec(String script) {
        SQLiteDatabase db = getDatabase();
        for (String statement : SqliteCompatibility.splitScript(script)) {
            if (SqliteCompatibility.shouldSkipStatement(statement)) {
                continue;
            }
            String normalized = statement.trim().toUpperCase(Locale.ROOT);
            if (normalized.startsWith("PRAGMA FOREIGN_KEYS")) {
                db.setForeignKeyConstraintsEnabled(true);
            } else if (normalized.startsWith("BEGIN")) {
                if (!transactionActive) {
                    db.beginTransaction();
                    transactionActive = true;
                }
            } else if (normalized.equals("COMMIT")) {
                if (transactionActive) {
                    db.setTransactionSuccessful();
                    db.endTransaction();
                    transactionActive = false;
                }
            } else if (normalized.equals("ROLLBACK")) {
                if (transactionActive) {
                    db.endTransaction();
                    transactionActive = false;
                }
            } else {
                db.execSQL(statement);
            }
        }
    }

    @JavascriptInterface
    public synchronized String query(String sql, String parametersJson) {
        List<Object> values = parseParameters(parametersJson);
        List<String> stringValues = new ArrayList<>();
        for (Object value : values) {
            stringValues.add(value == null ? null : String.valueOf(value));
        }
        SqliteCompatibility.Query query =
                SqliteCompatibility.rewriteQuery(sql, stringValues);
        try (Cursor cursor = getDatabase().rawQuery(
                query.sql,
                query.parameters.toArray(new String[0])
        )) {
            JSONArray rows = new JSONArray();
            while (cursor.moveToNext()) {
                JSONObject row = new JSONObject();
                for (int index = 0; index < cursor.getColumnCount(); index++) {
                    putColumn(row, cursor, index);
                }
                rows.put(row);
            }
            return rows.toString();
        } catch (JSONException error) {
            throw new IllegalStateException("Could not encode SQLite rows", error);
        }
    }

    @JavascriptInterface
    public synchronized String run(String sql, String parametersJson) {
        List<Object> parameters = parseParameters(parametersJson);
        SQLiteStatement statement = getDatabase().compileStatement(sql);
        try {
            bind(statement, parameters);
            long rowId = -1;
            int changes;
            String normalized = sql.trim().toUpperCase(Locale.ROOT);
            if (normalized.startsWith("INSERT")
                    || normalized.startsWith("REPLACE")) {
                rowId = statement.executeInsert();
                changes = rowId == -1 ? 0 : 1;
            } else {
                changes = statement.executeUpdateDelete();
                rowId = lastInsertRowId();
            }
            JSONObject result = new JSONObject();
            result.put("changes", changes);
            result.put("lastInsertRowid", rowId);
            return result.toString();
        } catch (JSONException error) {
            throw new IllegalStateException(
                    "Could not encode SQLite statement result",
                    error
            );
        } finally {
            statement.close();
        }
    }

    private SQLiteDatabase getDatabase() {
        if (database == null || !database.isOpen()) {
            File path = context.getDatabasePath(DATABASE_NAME);
            File parent = path.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) {
                throw new IllegalStateException(
                        "Could not create the database directory"
                );
            }
            database = SQLiteDatabase.openOrCreateDatabase(path, null);
            database.setForeignKeyConstraintsEnabled(true);
        }
        return database;
    }

    private List<Object> parseParameters(String json) {
        try {
            JSONArray array = new JSONArray(json == null ? "[]" : json);
            List<Object> result = new ArrayList<>(array.length());
            for (int index = 0; index < array.length(); index++) {
                Object value = array.get(index);
                if (value == JSONObject.NULL) {
                    result.add(null);
                } else if (value instanceof Boolean) {
                    result.add((Boolean) value ? 1L : 0L);
                } else {
                    result.add(value);
                }
            }
            return result;
        } catch (JSONException error) {
            throw new IllegalArgumentException(
                    "Invalid SQLite parameter array",
                    error
            );
        }
    }

    private void bind(SQLiteStatement statement, List<Object> parameters) {
        statement.clearBindings();
        for (int index = 0; index < parameters.size(); index++) {
            int binding = index + 1;
            Object value = parameters.get(index);
            if (value == null) {
                statement.bindNull(binding);
            } else if (value instanceof byte[]) {
                statement.bindBlob(binding, (byte[]) value);
            } else if (value instanceof Float || value instanceof Double) {
                statement.bindDouble(binding, ((Number) value).doubleValue());
            } else if (value instanceof Number) {
                statement.bindLong(binding, ((Number) value).longValue());
            } else {
                statement.bindString(binding, String.valueOf(value));
            }
        }
    }

    private long lastInsertRowId() {
        try (Cursor cursor = getDatabase().rawQuery(
                "SELECT last_insert_rowid()",
                null
        )) {
            return cursor.moveToFirst() ? cursor.getLong(0) : -1;
        }
    }

    private void putColumn(JSONObject row, Cursor cursor, int index)
            throws JSONException {
        String name = cursor.getColumnName(index);
        switch (cursor.getType(index)) {
            case Cursor.FIELD_TYPE_NULL:
                row.put(name, JSONObject.NULL);
                break;
            case Cursor.FIELD_TYPE_INTEGER:
                row.put(name, cursor.getLong(index));
                break;
            case Cursor.FIELD_TYPE_FLOAT:
                row.put(name, cursor.getDouble(index));
                break;
            case Cursor.FIELD_TYPE_BLOB:
                row.put(
                        name,
                        Base64.encodeToString(
                                cursor.getBlob(index),
                                Base64.NO_WRAP
                        )
                );
                break;
            case Cursor.FIELD_TYPE_STRING:
            default:
                row.put(name, cursor.getString(index));
                break;
        }
    }
}
