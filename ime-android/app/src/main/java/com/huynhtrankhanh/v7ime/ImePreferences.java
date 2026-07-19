package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

final class ImePreferences {
    static final int DEFAULT_PLOVER_PORT = 4020;

    private static final String PREFERENCES = "v7_ime_settings";
    private static final String MODEL_URI = "model_uri";
    private static final String PLOVER_HOST = "stripped_plover_host";
    private static final String PLOVER_PORT = "stripped_plover_port";

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

    static String getPloverHost(Context context) {
        return get(context).getString(PLOVER_HOST, "").trim();
    }

    static int getPloverPort(Context context) {
        return get(context).getInt(PLOVER_PORT, DEFAULT_PLOVER_PORT);
    }

    static void savePlover(Context context, String host, int port) {
        get(context).edit()
                .putString(PLOVER_HOST, host.trim())
                .putInt(PLOVER_PORT, port)
                .apply();
    }
}
