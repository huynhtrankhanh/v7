package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;

final class AppDataTransfer {
    private static final byte[] SQLITE_HEADER = new byte[]{
            'S', 'Q', 'L', 'i', 't', 'e', ' ', 'f', 'o', 'r', 'm', 'a', 't', ' ', '3', 0
    };
    private static final int BUFFER_SIZE = 64 * 1024;

    private AppDataTransfer() {
    }

    static File stageImport(Context context, Uri source) throws IOException {
        File database = context.getDatabasePath(
                NativeStrippedPloverSqlite.DATABASE_NAME
        );
        File directory = database.getParentFile();
        ensureDirectory(directory);
        File staged = File.createTempFile(
                "stripped-plover-import-",
                ".sqlite",
                directory
        );
        try (InputStream input = context.getContentResolver()
                .openInputStream(source)) {
            if (input == null) {
                throw new IOException("The selected file is unavailable");
            }
            copySqlite(input, staged);
            validateDatabase(staged);
            return staged;
        } catch (IOException | RuntimeException error) {
            deleteQuietly(staged);
            if (error instanceof IOException) {
                throw (IOException) error;
            }
            throw new IOException("The selected database is invalid", error);
        }
    }

    static void exportDatabase(Context context, Uri destination)
            throws IOException {
        File database = context.getDatabasePath(
                NativeStrippedPloverSqlite.DATABASE_NAME
        );
        ensureDirectory(database.getParentFile());
        if (!database.exists()) {
            SQLiteDatabase empty = SQLiteDatabase.openOrCreateDatabase(
                    database,
                    null
            );
            empty.close();
        }
        try (InputStream input = new FileInputStream(database);
             OutputStream output = context.getContentResolver()
                     .openOutputStream(destination, "w")) {
            if (output == null) {
                throw new IOException("The selected destination is unavailable");
            }
            copy(input, output);
        }
    }

    static void installStagedDatabase(Context context, File staged)
            throws IOException {
        File database = context.getDatabasePath(
                NativeStrippedPloverSqlite.DATABASE_NAME
        );
        deleteRequired(new File(database.getPath() + "-wal"));
        deleteRequired(new File(database.getPath() + "-shm"));
        replaceDatabase(staged, database);
    }

    static void copySqlite(InputStream input, File destination)
            throws IOException {
        byte[] header = new byte[SQLITE_HEADER.length];
        int offset = 0;
        while (offset < header.length) {
            int count = input.read(header, offset, header.length - offset);
            if (count == -1) {
                throw new IOException("The selected file is not a SQLite database");
            }
            offset += count;
        }
        if (!Arrays.equals(header, SQLITE_HEADER)) {
            throw new IOException("The selected file is not a SQLite database");
        }
        try (OutputStream output = new FileOutputStream(destination, false)) {
            output.write(header);
            copy(input, output);
        }
    }

    static void replaceDatabase(File staged, File database) throws IOException {
        ensureDirectory(database.getParentFile());
        File backup = File.createTempFile(
                "stripped-plover-backup-",
                ".sqlite",
                database.getParentFile()
        );
        if (!backup.delete()) {
            throw new IOException("Could not prepare the database backup");
        }
        boolean hadDatabase = database.exists();
        if (hadDatabase && !database.renameTo(backup)) {
            throw new IOException("Could not back up the current database");
        }
        boolean installed = false;
        try {
            if (!staged.renameTo(database)) {
                throw new IOException("Could not install the imported database");
            }
            installed = true;
        } finally {
            if (!installed && hadDatabase && !backup.renameTo(database)) {
                throw new IOException("Could not restore the current database");
            }
            if (installed) {
                deleteQuietly(backup);
            }
        }
    }

    private static void validateDatabase(File database) throws IOException {
        SQLiteDatabase sqlite = null;
        try {
            sqlite = SQLiteDatabase.openDatabase(
                    database.getPath(),
                    null,
                    SQLiteDatabase.OPEN_READONLY
            );
            try (Cursor cursor = sqlite.rawQuery("PRAGMA quick_check", null)) {
                if (!cursor.moveToFirst() || !"ok".equals(cursor.getString(0))) {
                    throw new IOException("The selected database failed its integrity check");
                }
            }
            int appTableCount = 0;
            try (Cursor cursor = sqlite.rawQuery(
                    "SELECT name FROM sqlite_master "
                            + "WHERE type = 'table' "
                            + "AND name IN ('dictionaries', 'entries')",
                    null
            )) {
                while (cursor.moveToNext()) {
                    appTableCount++;
                }
            }
            if (appTableCount == 1) {
                throw new IOException(
                        "The selected database has an incomplete app schema"
                );
            }
        } catch (RuntimeException error) {
            throw new IOException("The selected database is invalid", error);
        } finally {
            if (sqlite != null) {
                sqlite.close();
            }
        }
    }

    private static void copy(InputStream input, OutputStream output)
            throws IOException {
        byte[] buffer = new byte[BUFFER_SIZE];
        int count;
        while ((count = input.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }
    }

    private static void ensureDirectory(File directory) throws IOException {
        if (directory != null && !directory.exists() && !directory.mkdirs()) {
            throw new IOException("Could not create the database directory");
        }
    }

    private static void deleteRequired(File file) throws IOException {
        if (file.exists() && !file.delete()) {
            throw new IOException("Could not remove stale SQLite sidecar data");
        }
    }

    static void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            // Best-effort cleanup. A stale staging file is never used again.
            file.delete();
        }
    }
}
