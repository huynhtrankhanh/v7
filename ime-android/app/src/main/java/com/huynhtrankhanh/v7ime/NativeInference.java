package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import org.json.JSONObject;

import java.io.File;
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
        return inferNative(
                fd,
                modelUri.toString(),
                requestBody,
                rerankerEnabled(context),
                rerankerModelPath(context),
                ImePreferences.getRerankerModelId(context),
                context.getCacheDir().getAbsolutePath(),
                context.getApplicationInfo().nativeLibraryDir,
                ImePreferences.getRerankerTopK(context),
                cpuThreads()
        );
    }

    static void preloadReranker(Context context) {
        preloadRerankerNative(
                rerankerEnabled(context),
                rerankerModelPath(context),
                ImePreferences.getRerankerModelId(context),
                context.getCacheDir().getAbsolutePath(),
                context.getApplicationInfo().nativeLibraryDir,
                ImePreferences.getRerankerTopK(context),
                cpuThreads()
        );
    }

    static void cancelReranker() {
        cancelRerankerNative();
    }

    static String getRerankerState(Context context) {
        return statusValue(context, "state", "not_loaded");
    }

    static String getRerankerError(Context context) {
        return statusValue(context, "error", "");
    }

    static String getRerankerBackend(Context context) {
        return statusValue(context, "backend", "");
    }

    static String getRerankerWarning(Context context) {
        return statusValue(context, "warning", "");
    }

    static int getRerankerCompleted(Context context) {
        return statusIntValue(context, "completed");
    }

    static int getRerankerTotal(Context context) {
        return statusIntValue(context, "total");
    }

    private static String statusValue(
            Context context,
            String key,
            String fallback
    ) {
        try {
            return new JSONObject(rerankerStatusNative(
                    ImePreferences.isExperimentalRerankerEnabled(context),
                    RerankerModelStore.hasModel(context)
            )).optString(key, fallback);
        } catch (Exception error) {
            return fallback;
        }
    }

    private static int statusIntValue(Context context, String key) {
        try {
            return new JSONObject(rerankerStatusNative(
                    ImePreferences.isExperimentalRerankerEnabled(context),
                    RerankerModelStore.hasModel(context)
            )).optInt(key, 0);
        } catch (Exception error) {
            return 0;
        }
    }

    private static boolean rerankerEnabled(Context context) {
        return ImePreferences.isExperimentalRerankerEnabled(context)
                && RerankerModelStore.hasModel(context);
    }

    private static String rerankerModelPath(Context context) {
        File model = RerankerModelStore.getModelFile(context);
        return model.isFile() ? model.getAbsolutePath() : "";
    }

    private static int cpuThreads() {
        return RerankerExecutionPolicy.cpuThreadCount(
                Runtime.getRuntime().availableProcessors()
        );
    }

    private static native String inferNative(
            int modelFd,
            String modelId,
            String requestBody,
            boolean rerankerEnabled,
            String rerankerModelPath,
            String rerankerModelId,
            String rerankerCacheDir,
            String nativeLibraryDir,
            int rerankerTopK,
            int cpuThreads
    );

    private static native void preloadRerankerNative(
            boolean enabled,
            String modelPath,
            String modelId,
            String cacheDir,
            String nativeLibraryDir,
            int topK,
            int cpuThreads
    );

    private static native void cancelRerankerNative();

    private static native String rerankerStatusNative(
            boolean enabled,
            boolean hasModel
    );
}
