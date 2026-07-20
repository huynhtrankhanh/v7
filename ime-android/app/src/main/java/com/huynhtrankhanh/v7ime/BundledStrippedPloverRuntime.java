package com.huynhtrankhanh.v7ime;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

final class BundledStrippedPloverRuntime {
    private static final String LOG_TAG = "V7PloverRuntime";
    private static final long REQUEST_TIMEOUT_MS = 175_000L;
    private static final String RUNTIME_URL =
            "https://appassets.androidplatform.net/assets/"
                    + "stripped-plover-runtime.html";
    private static BundledStrippedPloverRuntime instance;

    interface Callback {
        void onResult(String response, String error);
    }

    static synchronized BundledStrippedPloverRuntime get(Context context) {
        if (instance == null) {
            instance = new BundledStrippedPloverRuntime(
                    context.getApplicationContext()
            );
        }
        return instance;
    }

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicInteger nextRequestId = new AtomicInteger(1);
    private final Map<Integer, PendingCallback> callbacks = new HashMap<>();
    private final List<PendingRequest> pendingRequests = new ArrayList<>();
    private WebView runtimeWebView;
    private boolean ready;
    private String startupError = "";

    private BundledStrippedPloverRuntime(Context context) {
        this.context = context;
    }

    void request(String body, Callback callback) {
        int requestId = nextRequestId.getAndIncrement();
        Runnable timeout = () -> timeout(requestId);
        PendingCallback pending = new PendingCallback(
                callback,
                describeRequest(body),
                SystemClock.elapsedRealtime(),
                timeout
        );
        synchronized (callbacks) {
            callbacks.put(requestId, pending);
        }
        log(
                "request=" + requestId
                        + " method=" + pending.method
                        + " phase=queued bytes="
                        + (body == null ? 0 : body.length())
        );
        mainHandler.postDelayed(timeout, REQUEST_TIMEOUT_MS);
        mainHandler.post(() -> enqueueOrDispatch(requestId, body));
    }

    void attachTo(FrameLayout host) {
        ensureRuntime();
        if (runtimeWebView == null || runtimeWebView.getParent() == host) {
            return;
        }
        ViewParent parent = runtimeWebView.getParent();
        if (parent instanceof ViewGroup) {
            ((ViewGroup) parent).removeView(runtimeWebView);
        }
        FrameLayout.LayoutParams layoutParams = new FrameLayout.LayoutParams(
                1,
                1,
                Gravity.TOP | Gravity.END
        );
        runtimeWebView.setVisibility(View.VISIBLE);
        runtimeWebView.setAlpha(0.01f);
        runtimeWebView.onResume();
        runtimeWebView.resumeTimers();
        host.addView(runtimeWebView, layoutParams);
        log("runtime WebView attached to " + host.getClass().getSimpleName());
    }

    void detachFrom(FrameLayout host) {
        if (runtimeWebView != null && runtimeWebView.getParent() == host) {
            host.removeView(runtimeWebView);
            log("runtime WebView detached from "
                    + host.getClass().getSimpleName());
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void ensureRuntime() {
        if (runtimeWebView != null) {
            return;
        }
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler(
                        "/assets/",
                        new WebViewAssetLoader.AssetsPathHandler(context)
                )
                .build();
        runtimeWebView = new WebView(context);
        WebSettings settings = runtimeWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        runtimeWebView.setBackgroundColor(Color.TRANSPARENT);
        runtimeWebView.setClickable(false);
        runtimeWebView.setFocusable(false);
        runtimeWebView.setImportantForAccessibility(
                View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            runtimeWebView.setRendererPriorityPolicy(
                    WebView.RENDERER_PRIORITY_IMPORTANT,
                    false
            );
        }
        runtimeWebView.setWebViewClient(new RuntimeWebViewClient(assetLoader));
        runtimeWebView.addJavascriptInterface(
                new RuntimeBridge(),
                "AndroidStrippedPloverRuntime"
        );
        runtimeWebView.addJavascriptInterface(
                new NativeStrippedPloverSqlite(context),
                "AndroidStrippedPloverSqlite"
        );
        runtimeWebView.loadUrl(RUNTIME_URL);
    }

    private void enqueueOrDispatch(int requestId, String body) {
        ensureRuntime();
        if (!startupError.isEmpty()) {
            complete(requestId, "", startupError);
        } else if (ready) {
            dispatch(requestId, body);
        } else {
            pendingRequests.add(new PendingRequest(requestId, body));
        }
    }

    private void dispatch(int requestId, String body) {
        if (runtimeWebView == null) {
            complete(requestId, "", "Stripped Plover runtime is unavailable");
            return;
        }
        PendingCallback pending;
        synchronized (callbacks) {
            pending = callbacks.get(requestId);
        }
        if (pending != null) {
            pending.lastPhase = "dispatch";
        }
        log(
                "request=" + requestId
                        + " method=" + (pending == null ? "unknown" : pending.method)
                        + " phase=dispatch"
        );
        runtimeWebView.evaluateJavascript(
                "window.StrippedPloverAndroidRuntime.request("
                        + requestId + ","
                        + JSONObject.quote(body)
                        + ")",
                null
        );
    }

    private void markReady() {
        mainHandler.post(() -> {
            ready = true;
            for (PendingRequest request : pendingRequests) {
                dispatch(request.id, request.body);
            }
            pendingRequests.clear();
        });
    }

    private void failStartup(String error) {
        mainHandler.post(() -> {
            startupError = error == null || error.isEmpty()
                    ? "Stripped Plover runtime failed to start"
                    : error;
            for (PendingRequest request : pendingRequests) {
                complete(request.id, "", startupError);
            }
            pendingRequests.clear();
        });
    }

    private void complete(int requestId, String response, String error) {
        PendingCallback pending;
        synchronized (callbacks) {
            pending = callbacks.remove(requestId);
        }
        if (pending != null) {
            mainHandler.removeCallbacks(pending.timeout);
            long elapsed = SystemClock.elapsedRealtime() - pending.startedAtMs;
            log(
                    "request=" + requestId
                            + " method=" + pending.method
                            + " phase=complete elapsedMs=" + elapsed
                            + " error=" + (error == null || error.isEmpty()
                                    ? "none"
                                    : error)
            );
            pending.callback.onResult(
                    response == null ? "" : response,
                    error == null ? "" : error
            );
        }
    }

    private static String describeRequest(String body) {
        if (body == null || body.isEmpty()) {
            return "unknown";
        }
        try {
            return new JSONObject(body).optString("method", "unknown");
        } catch (Exception ignored) {
            return "invalid-json";
        }
    }

    private void timeout(int requestId) {
        PendingCallback pending;
        synchronized (callbacks) {
            pending = callbacks.get(requestId);
        }
        if (pending == null) {
            return;
        }
        for (int index = pendingRequests.size() - 1; index >= 0; index--) {
            if (pendingRequests.get(index).id == requestId) {
                pendingRequests.remove(index);
            }
        }
        complete(
                requestId,
                "",
                "Stripped Plover timed out after 175 seconds at phase "
                        + pending.lastPhase
        );
    }

    private void log(String message) {
        Log.i(LOG_TAG, message);
        PloverDiagnostics.record(context, "runtime", message);
    }

    private static WebResourceResponse withIsolationHeaders(
            @Nullable WebResourceResponse response) {
        if (response == null) {
            return null;
        }
        Map<String, String> headers = response.getResponseHeaders();
        Map<String, String> updated = headers == null
                ? new HashMap<>()
                : new HashMap<>(headers);
        updated.put("Cross-Origin-Opener-Policy", "same-origin");
        updated.put("Cross-Origin-Embedder-Policy", "require-corp");
        updated.put("Cross-Origin-Resource-Policy", "same-origin");
        response.setResponseHeaders(updated);
        return response;
    }

    private class RuntimeBridge {
        @JavascriptInterface
        public void onReady() {
            markReady();
        }

        @JavascriptInterface
        public void onResponse(
                int requestId,
                String response,
                String error) {
            if (requestId == 0) {
                failStartup(error);
            } else {
                complete(requestId, response, error);
            }
        }

        @JavascriptInterface
        public void onDiagnostic(
                int requestId,
                String phase,
                String detail) {
            synchronized (callbacks) {
                PendingCallback pending = callbacks.get(requestId);
                if (pending != null) {
                    pending.lastPhase = phase;
                }
            }
            log(
                    "request=" + requestId
                            + " phase=" + phase
                            + " detail=" + detail
            );
        }
    }

    private static class RuntimeWebViewClient extends WebViewClientCompat {
        private final WebViewAssetLoader assetLoader;

        RuntimeWebViewClient(WebViewAssetLoader assetLoader) {
            this.assetLoader = assetLoader;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(
                WebView view,
                WebResourceRequest request) {
            return withIsolationHeaders(
                    assetLoader.shouldInterceptRequest(request.getUrl())
            );
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(
                WebView view,
                String url) {
            return withIsolationHeaders(
                    assetLoader.shouldInterceptRequest(Uri.parse(url))
            );
        }
    }

    private static class PendingRequest {
        final int id;
        final String body;

        PendingRequest(int id, String body) {
            this.id = id;
            this.body = body;
        }
    }

    private static class PendingCallback {
        final Callback callback;
        final String method;
        final long startedAtMs;
        final Runnable timeout;
        volatile String lastPhase = "queued";

        PendingCallback(
                Callback callback,
                String method,
                long startedAtMs,
                Runnable timeout) {
            this.callback = callback;
            this.method = method;
            this.startedAtMs = startedAtMs;
            this.timeout = timeout;
        }
    }
}
