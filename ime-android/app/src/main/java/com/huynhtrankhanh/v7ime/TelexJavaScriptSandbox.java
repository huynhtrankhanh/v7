package com.huynhtrankhanh.v7ime;

import android.content.Context;

import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/** Synchronous, DOM-free Telex conversion owned and invoked by native IME code. */
final class TelexJavaScriptSandbox implements AutoCloseable {
    private static final String ASSET = "telex-sandbox.js";
    private static final long TIMEOUT_SECONDS = 3;

    private final Context context;
    private JavaScriptSandbox sandbox;
    private JavaScriptIsolate isolate;

    TelexJavaScriptSandbox(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized String convert(String raw) {
        try {
            ensureStarted();
            return isolate.evaluateJavaScriptAsync(
                    "convertV7TelexRaw(" + JSONObject.quote(raw) + ")"
            ).get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (Exception error) {
            // Ordinary Latin input is safer than dropping a hardware key if
            // the platform sandbox is unavailable or being recreated.
            close();
            return raw;
        }
    }

    private void ensureStarted() throws Exception {
        if (isolate != null) return;
        if (!JavaScriptSandbox.isSupported()) {
            throw new IllegalStateException("JavaScriptSandbox is unavailable");
        }
        sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context)
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        isolate = sandbox.createIsolate();
        isolate.evaluateJavaScriptAsync(readAsset())
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private String readAsset() throws Exception {
        try (InputStream input = context.getAssets().open(ASSET);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    @Override
    public synchronized void close() {
        if (isolate != null) isolate.close();
        if (sandbox != null) sandbox.close();
        isolate = null;
        sandbox = null;
    }
}
