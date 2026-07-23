package com.huynhtrankhanh.v7ime;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
import androidx.webkit.ServiceWorkerClientCompat;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

final class BundledStrippedPloverRuntime {
    private static final long REQUEST_TIMEOUT_MS = 175_000L;
    private static final String RUNTIME_URL =
            "https://appassets.androidplatform.net/assets/"
                    + "stripped-plover-runtime.html";
    private static BundledStrippedPloverRuntime instance;

    interface Callback {
        void onResult(String response, String error);
    }

    interface DataTransferCallback {
        void onReady(String error);
    }

    interface StateListener {
        void onPausedChanged(boolean paused);
    }

    interface EventListener {
        void onPloverEvent(String event);
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
    private final List<StateListener> stateListeners = new ArrayList<>();
    private final List<EventListener> eventListeners = new ArrayList<>();
    private WebView runtimeWebView;
    private FrameLayout attachedHost;
    private NativeStrippedPloverSqlite sqlite;
    private boolean ready;
    private volatile boolean dataTransferInProgress;
    private String startupError = "";

    private BundledStrippedPloverRuntime(Context context) {
        this.context = context;
    }

    void request(String body, Callback callback) {
        int requestId = nextRequestId.getAndIncrement();
        Runnable timeout = () -> timeout(requestId);
        PendingCallback pending = new PendingCallback(
                callback,
                timeout
        );
        synchronized (callbacks) {
            if (dataTransferInProgress) {
                mainHandler.post(() -> rejectPausedRequest(body, callback));
                return;
            }
            callbacks.put(requestId, pending);
        }
        mainHandler.postDelayed(timeout, REQUEST_TIMEOUT_MS);
        mainHandler.post(() -> enqueueOrDispatch(requestId, body));
    }

    boolean isPaused() {
        return dataTransferInProgress;
    }

    void addStateListener(StateListener listener) {
        mainHandler.post(() -> {
            if (!stateListeners.contains(listener)) {
                stateListeners.add(listener);
            }
            listener.onPausedChanged(dataTransferInProgress);
        });
    }

    void removeStateListener(StateListener listener) {
        mainHandler.post(() -> stateListeners.remove(listener));
    }

    void addEventListener(EventListener listener) {
        mainHandler.post(() -> {
            if (!eventListeners.contains(listener)) {
                eventListeners.add(listener);
            }
        });
    }

    void removeEventListener(EventListener listener) {
        mainHandler.post(() -> eventListeners.remove(listener));
    }

    private void publishEvent(String event) {
        for (EventListener listener : new ArrayList<>(eventListeners)) {
            listener.onPloverEvent(event == null ? "" : event);
        }
    }

    private void publishPausedState() {
        for (StateListener listener : new ArrayList<>(stateListeners)) {
            listener.onPausedChanged(dataTransferInProgress);
        }
    }

    void attachTo(FrameLayout host) {
        if (dataTransferInProgress) {
            return;
        }
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
        attachedHost = host;
    }

    void detachFrom(FrameLayout host) {
        if (runtimeWebView != null && runtimeWebView.getParent() == host) {
            host.removeView(runtimeWebView);
        }
        if (attachedHost == host) {
            attachedHost = null;
        }
    }

    void pauseForDataTransfer(DataTransferCallback callback) {
        mainHandler.post(() -> {
            synchronized (callbacks) {
                if (!callbacks.isEmpty()) {
                    callback.onReady(
                            "Wait for the current Stripped Plover operation to finish"
                    );
                    return;
                }
            }
            if (runtimeWebView != null && !ready && startupError.isEmpty()) {
                callback.onReady(
                        "Wait for Stripped Plover to finish starting"
                );
                return;
            }
            if (!beginDataTransfer(callback)) {
                callback.onReady(
                        "Wait for the current Stripped Plover operation to finish"
                );
            }
        });
    }

    void pauseForDictionaryImport(DataTransferCallback callback) {
        long deadline = android.os.SystemClock.uptimeMillis() + REQUEST_TIMEOUT_MS;
        mainHandler.post(() -> waitToPauseForDictionaryImport(deadline, callback));
    }

    private void waitToPauseForDictionaryImport(
            long deadline,
            DataTransferCallback callback) {
        synchronized (callbacks) {
            if (!callbacks.isEmpty()) {
                if (android.os.SystemClock.uptimeMillis() >= deadline) {
                    callback.onReady(
                            "Timed out waiting for Stripped Plover to become idle"
                    );
                } else {
                    mainHandler.postDelayed(
                            () -> waitToPauseForDictionaryImport(deadline, callback),
                            100L
                    );
                }
                return;
            }
        }
        if (runtimeWebView != null && !ready && startupError.isEmpty()) {
            if (android.os.SystemClock.uptimeMillis() >= deadline) {
                callback.onReady(
                        "Timed out waiting for Stripped Plover to finish starting"
                );
            } else {
                mainHandler.postDelayed(
                        () -> waitToPauseForDictionaryImport(deadline, callback),
                        100L
                );
            }
            return;
        }
        if (!beginDataTransfer(callback)) {
            mainHandler.postDelayed(
                    () -> waitToPauseForDictionaryImport(deadline, callback),
                    100L
            );
        }
    }

    private boolean beginDataTransfer(DataTransferCallback callback) {
        synchronized (callbacks) {
            if (!callbacks.isEmpty()) {
                return false;
            }
            // Holding the same monitor as request() makes the transition
            // atomic: no request can appear after the idle check and then be
            // buffered for replay after the database handoff.
            dataTransferInProgress = true;
        }
        publishPausedState();
        ready = false;
        startupError = "";
        if (runtimeWebView != null) {
            ViewParent parent = runtimeWebView.getParent();
            if (parent instanceof ViewGroup) {
                ((ViewGroup) parent).removeView(runtimeWebView);
            }
            runtimeWebView.destroy();
            runtimeWebView = null;
        }
        if (sqlite != null) {
            sqlite.close();
            sqlite = null;
        }
        callback.onReady("");
        return true;
    }

    void resumeAfterDataTransfer() {
        mainHandler.post(() -> {
            dataTransferInProgress = false;
            publishPausedState();
            if (attachedHost != null) {
                attachTo(attachedHost);
            }
        });
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
        configureServiceWorkerAssetLoading(assetLoader);
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
        sqlite = new NativeStrippedPloverSqlite(context);
        runtimeWebView.addJavascriptInterface(
                sqlite,
                "AndroidStrippedPloverSqlite"
        );
        runtimeWebView.loadUrl(RUNTIME_URL);
    }

    private void configureServiceWorkerAssetLoading(
            WebViewAssetLoader assetLoader) {
        if (!WebViewFeature.isFeatureSupported(
                WebViewFeature.SERVICE_WORKER_BASIC_USAGE
        ) || !WebViewFeature.isFeatureSupported(
                WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST
        )) {
            return;
        }
        ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(
                new ServiceWorkerClientCompat() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(
                            WebResourceRequest request) {
                        if (!"GET".equals(request.getMethod())) {
                            return null;
                        }
                        return withIsolationHeaders(
                                assetLoader.shouldInterceptRequest(
                                        request.getUrl()
                                )
                        );
                    }
                }
        );
    }

    private void enqueueOrDispatch(int requestId, String body) {
        if (dataTransferInProgress) {
            completePausedRequest(requestId, body);
            return;
        }
        ensureRuntime();
        if (!startupError.isEmpty()) {
            complete(requestId, "", startupError);
        } else if (ready) {
            dispatch(requestId, body);
        } else {
            pendingRequests.add(new PendingRequest(requestId, body));
        }
    }

    private void completePausedRequest(int requestId, String body) {
        PendingCallback pending;
        synchronized (callbacks) {
            pending = callbacks.remove(requestId);
        }
        if (pending == null) {
            return;
        }
        mainHandler.removeCallbacks(pending.timeout);
        rejectPausedRequest(body, pending.callback);
    }

    private void rejectPausedRequest(String body, Callback callback) {
        try {
            JSONObject request = new JSONObject(body);
            if ("translate".equals(request.optString("method"))) {
                JSONObject result = new JSONObject()
                        .put("output", new org.json.JSONArray());
                callback.onResult(
                        new JSONObject()
                                .put("id", request.opt("id"))
                                .put("result", result)
                                .toString(),
                        ""
                );
                return;
            }
        } catch (Exception ignored) {
            // A malformed/non-translation request receives the pause error.
        }
        callback.onResult("", "Stripped Plover is paused");
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
            if (dataTransferInProgress) {
                return;
            }
            ready = true;
            for (PendingRequest request : pendingRequests) {
                dispatch(request.id, request.body);
            }
            pendingRequests.clear();
        });
    }

    private void failStartup(String error) {
        mainHandler.post(() -> {
            if (dataTransferInProgress) {
                return;
            }
            startupError = error == null || error.isEmpty()
                    ? "Stripped Plover runtime failed to start"
                    : error;
            for (PendingRequest request : pendingRequests) {
                complete(request.id, "", startupError);
            }
            pendingRequests.clear();
        });
    }

    private void runtimeNavigationStarted() {
        mainHandler.post(() -> {
            boolean wasReady = ready;
            ready = false;
            if (!wasReady) {
                return;
            }
            List<Integer> interrupted;
            synchronized (callbacks) {
                interrupted = new ArrayList<>(callbacks.keySet());
            }
            for (int requestId : interrupted) {
                complete(
                        requestId,
                        "",
                        "Stripped Plover runtime restarted during a request"
                );
            }
        });
    }

    private void complete(int requestId, String response, String error) {
        PendingCallback pending;
        synchronized (callbacks) {
            pending = callbacks.remove(requestId);
        }
        if (pending != null) {
            mainHandler.removeCallbacks(pending.timeout);
            pending.callback.onResult(
                    response == null ? "" : response,
                    error == null ? "" : error
            );
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
                "Stripped Plover timed out after 175 seconds"
        );
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
        public void onEvent(String event) {
            mainHandler.post(() -> publishEvent(event));
        }

    }

    private class RuntimeWebViewClient extends WebViewClientCompat {
        private final WebViewAssetLoader assetLoader;

        RuntimeWebViewClient(WebViewAssetLoader assetLoader) {
            this.assetLoader = assetLoader;
        }

        @Override
        public void onPageStarted(
                WebView view,
                String url,
                Bitmap favicon) {
            runtimeNavigationStarted();
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
        final Runnable timeout;

        PendingCallback(
                Callback callback,
                Runnable timeout) {
            this.callback = callback;
            this.timeout = timeout;
        }
    }
}
