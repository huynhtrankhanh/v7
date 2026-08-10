package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

final class NativeInference {
    static {
        System.loadLibrary("inference_rs");
    }

    private NativeInference() {
    }

    static String infer(Context context, String requestBody) throws IOException {
        Uri modelUri = ImePreferences.getModelUri(context);
        if (modelUri == null) {
            throw new IOException(
                    "Choose a local lm.binary file in V7 IME settings"
            );
        }

        ParcelFileDescriptor descriptor = context.getContentResolver()
                .openFileDescriptor(modelUri, "r");
        if (descriptor == null) {
            throw new IOException("The selected language model is unavailable");
        }

        int fd;
        try {
            fd = descriptor.detachFd();
        } finally {
            descriptor.close();
        }
        Uri dictionaryUri = ImePreferences.getDictionaryModeUri(context);
        String dictionarySource = dictionaryUri == null
                ? ""
                : readDictionary(context, dictionaryUri);
        return inferNative(
                fd,
                modelUri.toString(),
                dictionaryUri == null
                        ? ""
                        : dictionaryUri + ":" + dictionarySource.hashCode(),
                dictionarySource,
                requestBody
        );
    }

    private static String readDictionary(Context context, Uri uri) throws IOException {
        try (InputStream input = context.getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IOException("The selected dictionary is unavailable");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int count;
            int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > 8 * 1024 * 1024) {
                    throw new IOException("The dictionary TXT file exceeds 8 MiB");
                }
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
