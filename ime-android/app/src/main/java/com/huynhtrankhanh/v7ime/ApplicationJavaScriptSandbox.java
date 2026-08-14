package com.huynhtrankhanh.v7ime;

import android.content.Context;

import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;

import java.util.concurrent.TimeUnit;

/** Process-wide JavaScriptSandbox owner. Callers create independent isolates. */
final class ApplicationJavaScriptSandbox {
    private static JavaScriptSandbox sandbox;

    private ApplicationJavaScriptSandbox() {
    }

    static synchronized JavaScriptSandbox get(
            Context context, long timeout, TimeUnit unit) throws Exception {
        if (sandbox == null) {
            if (!JavaScriptSandbox.isSupported()) {
                throw new IllegalStateException("JavaScriptSandbox is unavailable");
            }
            sandbox = JavaScriptSandbox.createConnectedInstanceAsync(
                    context.getApplicationContext()).get(timeout, unit);
        }
        return sandbox;
    }

    static JavaScriptIsolate createIsolate(
            Context context, long timeout, TimeUnit unit) throws Exception {
        return get(context, timeout, unit).createIsolate();
    }
}
