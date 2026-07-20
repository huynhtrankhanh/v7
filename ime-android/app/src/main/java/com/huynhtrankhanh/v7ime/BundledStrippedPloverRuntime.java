package com.huynhtrankhanh.v7ime;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

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
    private final Map<Integer, Callback> callbacks = new HashMap<>();
    private final List<PendingRequest> pendingRequests = new ArrayList<>();
    private WebView runtimeWebView;
    private boolean ready;
    private String startupError = "";

    private BundledStrippedPloverRuntime(Context context) {
        this.context = context;
    }

    void request(String body, Callback callback) {
        int requestId = nextRequestId.getAndIncrement();
        synchronized (callbacks) {
            callbacks.put(requestId, callback);
        }
        mainHandler.post(() -> enqueueOrDispatch(requestId, body));
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
        Callback callback;
        synchronized (callbacks) {
            callback = callbacks.remove(requestId);
        }
        if (callback != null) {
            callback.onResult(
                    response == null ? "" : response,
                    error == null ? "" : error
            );
        }
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
}
