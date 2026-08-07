package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

final class ImePreferences {
    private static final String PREFERENCES = "v7_ime_settings";
    private static final String MODEL_URI = "model_uri";
    private static final String EXPERIMENTAL_RERANKER_ENABLED =
            "experimental_reranker_enabled";
    private static final String RERANKER_MODEL_URI = "reranker_model_uri";
    private static final String RERANKER_MODEL_ID = "reranker_model_id";
    private static final String RERANKER_MODEL_NAME = "reranker_model_name";
    private static final String RERANKER_MODEL_SIZE = "reranker_model_size";

    private ImePreferences() {
    }

    static SharedPreferences get(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    static Uri getModelUri(Context context) {
        String value = get(context).getString(MODEL_URI, "");
        return value == null || value.isEmpty() ? null : Uri.parse(value);
    }

    static void setModelUri(Context context, Uri uri) {
        get(context).edit().putString(MODEL_URI, uri.toString()).apply();
    }

    static boolean isExperimentalRerankerEnabled(Context context) {
        return get(context).getBoolean(EXPERIMENTAL_RERANKER_ENABLED, false);
    }

    static void setExperimentalRerankerEnabled(Context context, boolean enabled) {
        get(context).edit().putBoolean(EXPERIMENTAL_RERANKER_ENABLED, enabled).apply();
    }

    static Uri getRerankerModelUri(Context context) {
        String value = get(context).getString(RERANKER_MODEL_URI, "");
        return value == null || value.isEmpty() ? null : Uri.parse(value);
    }

    static String getRerankerModelId(Context context) {
        String value = get(context).getString(RERANKER_MODEL_ID, "");
        return value == null ? "" : value;
    }

    static String getRerankerModelName(Context context) {
        String value = get(context).getString(RERANKER_MODEL_NAME, "");
        return value == null ? "" : value;
    }

    static long getRerankerModelSize(Context context) {
        return get(context).getLong(RERANKER_MODEL_SIZE, -1L);
    }

    static void setRerankerModel(
            Context context,
            Uri uri,
            String modelId,
            String displayName,
            long size
    ) {
        get(context).edit()
                .putString(RERANKER_MODEL_URI, uri.toString())
                .putString(RERANKER_MODEL_ID, modelId)
                .putString(RERANKER_MODEL_NAME, displayName)
                .putLong(RERANKER_MODEL_SIZE, size)
                .apply();
    }
}
