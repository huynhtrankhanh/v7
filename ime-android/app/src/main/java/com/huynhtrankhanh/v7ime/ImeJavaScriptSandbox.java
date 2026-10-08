package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.util.Log;

import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/** Owns V7 input state independently of the display WebView's renderer. */
final class ImeJavaScriptSandbox implements AutoCloseable {
    private static final String ASSET = "ime-sandbox.js";
    private final Context context;
    private JavaScriptSandbox sandbox;
    private JavaScriptIsolate isolate;
    private volatile boolean ready;
    private boolean warming;
    private boolean closed;
    private long generation;

    ImeJavaScriptSandbox(Context context) {
        this.context = context.getApplicationContext();
    }

    void warmAsync(Executor executor, Runnable stateChanged) {
        synchronized (this) {
            if (closed || ready || warming) return;
            warming = true;
        }
        executor.execute(() -> {
            JavaScriptIsolate candidate = null;
            JavaScriptSandbox shared = null;
            try {
                synchronized (this) { if (closed) return; }
                shared = ApplicationJavaScriptSandbox.get(context, 3, TimeUnit.SECONDS);
                if (!shared.isFeatureSupported(JavaScriptSandbox.JS_FEATURE_PROMISE_RETURN)) {
                    throw new IllegalStateException("V7 input requires sandbox Promise support");
                }
                candidate = shared.createIsolate();
                candidate.evaluateJavaScriptAsync(readAsset()).get(3, TimeUnit.SECONDS);
                synchronized (this) {
                    if (closed) return;
                    sandbox = shared;
                    isolate = candidate;
                    candidate = null;
                    ready = true;
                }
            } catch (Exception error) {
                if (ApplicationJavaScriptSandbox.isSandboxDead(error)) {
                    ApplicationJavaScriptSandbox.invalidate(shared);
                }
                Log.e("V7Ime", "Input sandbox startup failed", error);
            } finally {
                if (candidate != null) candidate.close();
                boolean notify;
                synchronized (this) { warming = false; notify = !closed; }
                if (notify) stateChanged.run();
            }
        });
    }

    boolean isReady() { return ready; }

    synchronized long generation() { return generation; }

    synchronized JSONObject dispatch(JSONObject command) throws Exception {
        return evaluate("v7Input.dispatch(" + command + ")");
    }

    synchronized JSONObject reply(int id, String valueJson, String error) throws Exception {
        return evaluate("v7Input.reply(" + id + "," + valueJson + ","
                + JSONObject.quote(error) + ")");
    }

    private JSONObject evaluate(String script) throws Exception {
        if (!ready || isolate == null) throw new IllegalStateException("V7 input sandbox is unavailable");
        try {
            // Unlike WebView evaluation, completion doesn't require Android's
            // main loop. A stroke waits for sandbox work and native inference.
            // Allow CPU contention without Telex's short conversion deadline.
            return new JSONObject(isolate.evaluateJavaScriptAsync(script).get(4, TimeUnit.SECONDS));
        } catch (Exception error) {
            if (ApplicationJavaScriptSandbox.isSandboxDead(error)) {
                ApplicationJavaScriptSandbox.invalidate(sandbox);
            }
            closeIsolate();
            throw error;
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
    public synchronized void close() { closed = true; closeIsolate(); }

    private void closeIsolate() {
        generation++;
        ready = false;
        if (isolate != null) isolate.close();
        isolate = null;
        sandbox = null;
    }
}
