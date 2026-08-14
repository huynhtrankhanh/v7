package com.huynhtrankhanh.v7ime;

import android.content.Context;

import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Executor;

/** Synchronous, DOM-free Telex conversion owned and invoked by native IME code. */
final class TelexJavaScriptSandbox implements AutoCloseable {
    private static final String ASSET = "telex-sandbox.js";
    private static final long STARTUP_TIMEOUT_SECONDS = 3;
    private static final long WARM_CONVERSION_TIMEOUT_MILLIS = 100;

    private final Context context;
    private JavaScriptSandbox sandbox;
    private JavaScriptIsolate isolate;
    private volatile boolean ready;
    private boolean warming;
    private boolean closed;

    TelexJavaScriptSandbox(Context context) {
        this.context = context.getApplicationContext();
    }

    void warmAsync(Executor executor, Runnable stateChanged) {
        synchronized (this) {
            if (closed || ready || warming) return;
            warming = true;
        }
        executor.execute(() -> {
            boolean notify;
            try {
                startAndWarm();
            } finally {
                synchronized (this) {
                    warming = false;
                    notify = !closed;
                }
                if (notify) stateChanged.run();
            }
        });
    }

    boolean isReady() {
        return ready;
    }

    String convertIfReady(String raw) {
        if (!ready) return null;
        synchronized (this) {
            if (!ready || isolate == null) return null;
            try {
                return isolate.evaluateJavaScriptAsync(
                        "convertV7TelexRaw(" + JSONObject.quote(raw) + ")"
                ).get(WARM_CONVERSION_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS);
            } catch (Exception error) {
                if (ApplicationJavaScriptSandbox.isSandboxDead(error)) {
                    ApplicationJavaScriptSandbox.invalidate(sandbox);
                }
                closeIsolate();
                return null;
            }
        }
    }

    private void startAndWarm() {
        synchronized (this) {
            if (closed) return;
        }
        JavaScriptIsolate candidate = null;
        JavaScriptSandbox shared = null;
        try {
            shared = ApplicationJavaScriptSandbox.get(
                    context, STARTUP_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            candidate = shared.createIsolate();
            candidate.evaluateJavaScriptAsync(readAsset())
                    .get(STARTUP_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            // Force construction of the generated V7 tone oracle before the
            // first physical tone key reaches the IME main thread.
            String warm = candidate.evaluateJavaScriptAsync(
                    "convertV7TelexRaw('tieengs')"
            ).get(STARTUP_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            synchronized (this) {
                if (closed) return;
                if (isolate != null) isolate.close();
                sandbox = shared;
                isolate = candidate;
                candidate = null;
                ready = "tiếng".equals(warm);
            }
        } catch (Exception error) {
            if (ApplicationJavaScriptSandbox.isSandboxDead(error)) {
                ApplicationJavaScriptSandbox.invalidate(shared);
            }
            synchronized (this) {
                ready = false;
            }
        } finally {
            if (candidate != null) candidate.close();
        }
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
        closed = true;
        closeIsolate();
    }

    private void closeIsolate() {
        ready = false;
        if (isolate != null) isolate.close();
        isolate = null;
        sandbox = null;
    }
}
