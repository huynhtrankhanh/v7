package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.IOException;

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
        return inferNative(fd, modelUri.toString(), requestBody);
    }

    private static native String inferNative(
            int modelFd,
            String modelId,
            String requestBody
    );
}
