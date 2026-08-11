package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

final class ImePreferences {
    private static final String PREFERENCES = "v7_ime_settings";
    private static final String MODEL_URI = "model_uri";
    private static final String DICTIONARY_URI = "dictionary_mode_uri";

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

    static Uri getDictionaryModeUri(Context context) {
        String value = get(context).getString(DICTIONARY_URI, "");
        return value == null || value.isEmpty() ? null : Uri.parse(value);
    }

    static void setDictionaryModeUri(Context context, Uri uri) {
        get(context).edit().putString(DICTIONARY_URI, uri.toString()).apply();
    }

    static void clearDictionaryModeUri(Context context) {
        get(context).edit().remove(DICTIONARY_URI).apply();
    }

}
