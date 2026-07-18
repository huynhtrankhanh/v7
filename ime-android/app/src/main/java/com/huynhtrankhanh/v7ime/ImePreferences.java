package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.content.SharedPreferences;

import java.net.URI;
import java.net.URISyntaxException;

final class ImePreferences {
    private static final String PREFERENCES = "v7_ime_settings";
    private static final String SERVER_URL = "server_url";
    private static final String USERNAME = "http_username";
    private static final String PASSWORD = "http_password";

    private ImePreferences() {
    }

    static SharedPreferences get(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    static String getServerUrl(Context context) {
        return get(context).getString(SERVER_URL, "").trim();
    }

    static String getInferenceEndpoint(Context context) {
        String url = getServerUrl(context);
        if (url.isEmpty()) {
            return "";
        }
        try {
            URI base = new URI(url);
            String path = base.getPath() == null ? "" : base.getPath();
            while (path.endsWith("/")) {
                path = path.substring(0, path.length() - 1);
            }
            if (!path.endsWith("/infer")) {
                path += "/infer";
            }
            return new URI(
                    base.getScheme(),
                    base.getUserInfo(),
                    base.getHost(),
                    base.getPort(),
                    path,
                    base.getQuery(),
                    base.getFragment()
            ).toString();
        } catch (URISyntaxException error) {
            return "";
        }
    }

    static String getUsername(Context context) {
        return get(context).getString(USERNAME, "");
    }

    static String getPassword(Context context) {
        return get(context).getString(PASSWORD, "");
    }

    static void save(
            Context context,
            String serverUrl,
            String username,
            String password) {
        get(context).edit()
                .putString(SERVER_URL, serverUrl.trim())
                .putString(USERNAME, username)
                .putString(PASSWORD, password)
                .apply();
    }
}
