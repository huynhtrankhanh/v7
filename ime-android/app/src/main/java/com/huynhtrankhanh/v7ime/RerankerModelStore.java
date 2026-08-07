package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.text.TextUtils;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.UUID;

final class RerankerModelStore {
    private static final String DIRECTORY = "experimental-reranker";
    private static final String MODEL_FILE = "model.litertlm";

    static final class InstalledModel {
        final String displayName;
        final long size;

        InstalledModel(String displayName, long size) {
            this.displayName = displayName;
            this.size = size;
        }
    }

    private RerankerModelStore() {
    }

    static File getModelFile(Context context) {
        return new File(new File(context.getNoBackupFilesDir(), DIRECTORY), MODEL_FILE);
    }

    static boolean hasModel(Context context) {
        File model = getModelFile(context);
        return model.isFile() && model.length() > 0;
    }

    static InstalledModel install(Context context, Uri source) throws IOException {
        File directory = getModelFile(context).getParentFile();
        if (directory == null || (!directory.isDirectory() && !directory.mkdirs())) {
            throw new IOException("Could not create the private reranker directory");
        }
        File staged = new File(directory, "model-" + UUID.randomUUID() + ".partial");
        long size = 0;
        try (InputStream input = context.getContentResolver().openInputStream(source);
             FileOutputStream output = new FileOutputStream(staged)) {
            if (input == null) {
                throw new IOException("The selected reranker model is unavailable");
            }
            byte[] buffer = new byte[1024 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
                size += count;
            }
            output.getFD().sync();
        } catch (IOException error) {
            deleteQuietly(staged);
            throw error;
        }
        if (size == 0) {
            deleteQuietly(staged);
            throw new IOException("The selected reranker model is empty");
        }

        File destination = getModelFile(context);
        try {
            Files.move(
                    staged.toPath(),
                    destination.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING
            );
        } catch (AtomicMoveNotSupportedException ignored) {
            try {
                Files.move(
                        staged.toPath(),
                        destination.toPath(),
                        StandardCopyOption.REPLACE_EXISTING
                );
            } catch (IOException error) {
                deleteQuietly(staged);
                throw error;
            }
        } catch (IOException error) {
            deleteQuietly(staged);
            throw error;
        }

        String displayName = queryDisplayName(context, source);
        if (TextUtils.isEmpty(displayName)) {
            displayName = source.getLastPathSegment();
        }
        if (TextUtils.isEmpty(displayName)) {
            displayName = MODEL_FILE;
        }
        return new InstalledModel(displayName, size);
    }

    private static String queryDisplayName(Context context, Uri source) {
        try (Cursor cursor = context.getContentResolver().query(
                source,
                new String[]{OpenableColumns.DISPLAY_NAME},
                null,
                null,
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    return cursor.getString(index);
                }
            }
        } catch (Exception ignored) {
            // A provider name is cosmetic; the private copy remains usable.
        }
        return "";
    }

    private static void deleteQuietly(File file) {
        if (file.isFile()) {
            // Best effort. A failed partial remains isolated and is never loaded.
            file.delete();
        }
    }
}
