package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;

import androidx.webkit.WebViewCompat;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

final class PloverDiagnostics {
    private static final String PREFERENCES_NAME = "plover_diagnostics";
    private static final String HISTORY_KEY = "history";
    private static final int MAX_HISTORY_CHARS = 64 * 1024;
    private static final Object LOCK = new Object();

    private static String history;

    private PloverDiagnostics() {
    }

    static void record(Context context, String source, String message) {
        Context applicationContext = context.getApplicationContext();
        synchronized (LOCK) {
            ensureLoaded(applicationContext);
            String line = timestamp() + " [" + source + "] " + message + "\n";
            history = trimToLimit(history + line);
            preferences(applicationContext)
                    .edit()
                    .putString(HISTORY_KEY, history)
                    .apply();
        }
    }

    static String export(Context context) {
        Context applicationContext = context.getApplicationContext();
        synchronized (LOCK) {
            ensureLoaded(applicationContext);
            StringBuilder output = new StringBuilder();
            output.append("V7 Stripped Plover diagnostics\n");
            output.append("Exported: ").append(timestamp()).append('\n');
            output.append("Android SDK: ").append(Build.VERSION.SDK_INT).append('\n');
            output.append("Device: ")
                    .append(Build.MANUFACTURER)
                    .append(' ')
                    .append(Build.MODEL)
                    .append('\n');
            try {
                PackageInfo app = applicationContext.getPackageManager()
                        .getPackageInfo(applicationContext.getPackageName(), 0);
                output.append("App: ")
                        .append(app.versionName)
                        .append(" (")
                        .append(Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                                ? app.getLongVersionCode()
                                : app.versionCode)
                        .append(")\n");
            } catch (Exception ignored) {
                output.append("App: unknown\n");
            }
            PackageInfo webView = WebViewCompat.getCurrentWebViewPackage(
                    applicationContext
            );
            output.append("WebView: ")
                    .append(webView == null
                            ? "unknown"
                            : webView.packageName + " " + webView.versionName)
                    .append("\n\n");
            output.append(history.isEmpty() ? "(no events recorded)\n" : history);
            return output.toString();
        }
    }

    static void clear(Context context) {
        Context applicationContext = context.getApplicationContext();
        synchronized (LOCK) {
            history = "";
            preferences(applicationContext).edit().remove(HISTORY_KEY).apply();
        }
    }

    private static void ensureLoaded(Context context) {
        if (history == null) {
            history = preferences(context).getString(HISTORY_KEY, "");
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(
                PREFERENCES_NAME,
                Context.MODE_PRIVATE
        );
    }

    private static String trimToLimit(String value) {
        if (value.length() <= MAX_HISTORY_CHARS) {
            return value;
        }
        int start = value.length() - MAX_HISTORY_CHARS;
        int nextLine = value.indexOf('\n', start);
        return nextLine < 0 ? value.substring(start) : value.substring(nextLine + 1);
    }

    private static String timestamp() {
        SimpleDateFormat format = new SimpleDateFormat(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                Locale.US
        );
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }
}
