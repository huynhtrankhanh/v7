package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class NativeInference {
    private static final InferenceSession SESSION = new InferenceSession(
            NativeInference::inferNative,
            Executors.newSingleThreadExecutor(runnable -> {
                Thread thread = new Thread(runnable, "v7-dictionary-refresh");
                thread.setDaemon(true);
                return thread;
            }),
            SystemClock::elapsedRealtime);

    static {
        System.loadLibrary("inference_rs");
    }

    private NativeInference() {
    }

    static String infer(Context context, String requestBody) throws IOException {
        Uri modelUri = ImePreferences.getModelUri(context);
        if (modelUri == null) {
            throw new IOException("Choose a local lm.binary file in V7 IME settings");
        }
        Uri dictionaryUri = ImePreferences.getDictionaryModeUri(context);
        Context application = context.getApplicationContext();
        return SESSION.infer(new InferenceSession.Resources() {
            @Override
            public int openModel(String uri) throws IOException {
                try (ParcelFileDescriptor descriptor = application.getContentResolver()
                        .openFileDescriptor(Uri.parse(uri), "r")) {
                    if (descriptor == null) {
                        throw new IOException("The selected language model is unavailable");
                    }
                    return descriptor.detachFd();
                }
            }

            @Override
            public String dictionaryVersion(String uri) {
                return NativeInference.dictionaryVersion(application, Uri.parse(uri));
            }

            @Override
            public String readDictionary(String uri) throws IOException {
                try {
                    return NativeInference.readDictionary(application, Uri.parse(uri));
                } catch (RuntimeException error) {
                    throw new IOException("The selected dictionary is unavailable", error);
                }
            }
        }, modelUri.toString(), dictionaryUri == null ? "" : dictionaryUri.toString(),
                requestUsesDictionaryMode(requestBody), requestBody);
    }

    static void invalidateDictionaryCache() {
        SESSION.invalidateDictionary();
    }

    private static boolean requestUsesDictionaryMode(String requestBody) {
        try {
            JSONArray islands = new JSONObject(requestBody).optJSONArray("islands");
            if (islands == null) return false;
            for (int index = 0; index < islands.length(); index++) {
                JSONObject island = islands.optJSONObject(index);
                if (island != null
                        && "v7".equals(island.optString("kind"))
                        && "dictionary".equals(island.optString("mode"))) {
                    return true;
                }
            }
        } catch (JSONException ignored) {
            // Native inference reports malformed request JSON consistently.
        }
        return false;
    }

    private static String dictionaryVersion(Context context, Uri uri) {
        if (uri == null) return "bundled";
        try (Cursor cursor = context.getContentResolver().query(
                uri,
                new String[]{
                        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                        OpenableColumns.SIZE
                },
                null,
                null,
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                long modified = cursor.isNull(0) ? -1 : cursor.getLong(0);
                long size = cursor.isNull(1) ? -1 : cursor.getLong(1);
                return modified + ":" + size;
            }
        } catch (Exception ignored) {
            // A provider may omit metadata; reselection still invalidates cache.
        }
        return "unknown";
    }

    private static String readDictionary(Context context, Uri uri) throws IOException {
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("The selected dictionary is unavailable");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static native String inferNative(
            int modelFd,
            String modelId,
            String dictionaryId,
            String dictionarySource,
            String requestBody
    );
}
