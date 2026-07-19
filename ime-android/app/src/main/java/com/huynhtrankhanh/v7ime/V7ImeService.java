package com.huynhtrankhanh.v7ime;

import android.annotation.SuppressLint;
import android.content.pm.ApplicationInfo;
import android.inputmethodservice.InputMethodService;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class V7ImeService extends InputMethodService {
    private static final int DEFAULT_KEYBOARD_HEIGHT_DP = 300;
    private static final int MIN_KEYBOARD_HEIGHT_DP = 160;

    private final ExecutorService inferenceExecutor = Executors.newCachedThreadPool();
    private final ExecutorService ploverExecutor = Executors.newSingleThreadExecutor();
    private final StrippedPloverClient ploverClient = new StrippedPloverClient();
    private FrameLayout inputContainer;
    private WebView webView;
    private String preeditText = "";
    private final Deque<Integer> pendingPreeditLengths = new ArrayDeque<>();
    private final AtomicInteger inputGeneration = new AtomicInteger();
    private String lastKeyEventSignature = "";

    @Override
    public View onCreateInputView() {
        inputContainer = new FrameLayout(this);
        webView = new ImeWebView();
        inputContainer.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                dpToPx(DEFAULT_KEYBOARD_HEIGHT_DP)
        ));
        configureWebView(webView);
        webView.loadUrl("file:///android_asset/ime.html");
        return inputContainer;
    }

    @Override
    public boolean onEvaluateInputViewShown() {
        super.onEvaluateInputViewShown();
        return true;
    }

    @Override
    public void onStartInput(EditorInfo attribute, boolean restarting) {
        clearPreeditSession();
        super.onStartInput(attribute, restarting);
    }

    @Override
    public void onFinishInput() {
        clearPreeditSession();
        super.onFinishInput();
    }

    @Override
    public void onUpdateSelection(
            int oldSelStart,
            int oldSelEnd,
            int newSelStart,
            int newSelEnd,
            int candidatesStart,
            int candidatesEnd) {
        super.onUpdateSelection(
                oldSelStart,
                oldSelEnd,
                newSelStart,
                newSelEnd,
                candidatesStart,
                candidatesEnd
        );
        if (preeditText.isEmpty()) {
            pendingPreeditLengths.clear();
            return;
        }

        if (isExpectedPreeditChangedSelection(
                newSelStart,
                newSelEnd,
                candidatesStart,
                candidatesEnd)) {
            return;
        }
        pendingPreeditLengths.clear();

        if (oldSelStart != newSelStart || oldSelEnd != newSelEnd) {
            clearPreeditSession();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (dispatchPhysicalKeyToWeb("keydown", event)) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (dispatchPhysicalKeyToWeb("keyup", event)) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public void onDestroy() {
        inferenceExecutor.shutdownNow();
        ploverExecutor.shutdownNow();
        ploverClient.close();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        view.setWebViewClient(new WebViewClient());
        view.setWebChromeClient(new WebChromeClient());
        view.addJavascriptInterface(new AndroidBridge(), "AndroidIme");
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.requestFocus();
        boolean debuggable = (getApplicationInfo().flags
                & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);
    }

    private boolean dispatchPhysicalKeyToWeb(String action, KeyEvent event) {
        if (webView == null || !isCapturedKey(event.getKeyCode())) {
            return false;
        }

        String signature = action + ":" + event.getKeyCode() + ":" + event.getEventTime();
        if (signature.equals(lastKeyEventSignature)) {
            return true;
        }
        lastKeyEventSignature = signature;

        String key = getJavascriptKey(event);
        String code = getJavascriptCode(event.getKeyCode());
        String script = "window.handleAndroidKeyEvent && window.handleAndroidKeyEvent("
                + JSONObject.quote(action) + ","
                + JSONObject.quote(key) + ","
                + JSONObject.quote(code) + ","
                + (event.getRepeatCount() > 0) + ","
                + event.isShiftPressed() + ","
                + event.isCtrlPressed() + ","
                + event.isAltPressed() + ","
                + event.isMetaPressed()
                + ")";
        webView.evaluateJavascript(script, null);
        return true;
    }

    private boolean isCapturedKey(int keyCode) {
        return (keyCode >= KeyEvent.KEYCODE_A && keyCode <= KeyEvent.KEYCODE_Z)
                || (keyCode >= KeyEvent.KEYCODE_0 && keyCode <= KeyEvent.KEYCODE_9)
                || keyCode == KeyEvent.KEYCODE_SEMICOLON
                || keyCode == KeyEvent.KEYCODE_SPACE
                || keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
                || keyCode == KeyEvent.KEYCODE_SHIFT_LEFT
                || keyCode == KeyEvent.KEYCODE_SHIFT_RIGHT
                || keyCode == KeyEvent.KEYCODE_CTRL_LEFT
                || keyCode == KeyEvent.KEYCODE_CTRL_RIGHT
                || keyCode == KeyEvent.KEYCODE_ALT_LEFT
                || keyCode == KeyEvent.KEYCODE_ALT_RIGHT
                || keyCode == KeyEvent.KEYCODE_META_LEFT
                || keyCode == KeyEvent.KEYCODE_META_RIGHT
                || keyCode == KeyEvent.KEYCODE_ESCAPE;
    }

    private String getJavascriptKey(KeyEvent event) {
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_SPACE:
                return " ";
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                return "Enter";
            case KeyEvent.KEYCODE_SHIFT_LEFT:
            case KeyEvent.KEYCODE_SHIFT_RIGHT:
                return "Shift";
            case KeyEvent.KEYCODE_CTRL_LEFT:
            case KeyEvent.KEYCODE_CTRL_RIGHT:
                return "Control";
            case KeyEvent.KEYCODE_ALT_LEFT:
            case KeyEvent.KEYCODE_ALT_RIGHT:
                return "Alt";
            case KeyEvent.KEYCODE_META_LEFT:
            case KeyEvent.KEYCODE_META_RIGHT:
                return "Meta";
            case KeyEvent.KEYCODE_ESCAPE:
                return "Escape";
            default:
                int unicode = event.getUnicodeChar();
                if (unicode != 0) {
                    return new String(Character.toChars(unicode));
                }
                return "";
        }
    }

    private String getJavascriptCode(int keyCode) {
        if (keyCode >= KeyEvent.KEYCODE_A && keyCode <= KeyEvent.KEYCODE_Z) {
            return "Key" + (char) ('A' + keyCode - KeyEvent.KEYCODE_A);
        }
        if (keyCode >= KeyEvent.KEYCODE_0 && keyCode <= KeyEvent.KEYCODE_9) {
            return "Digit" + (keyCode - KeyEvent.KEYCODE_0);
        }
        switch (keyCode) {
            case KeyEvent.KEYCODE_SEMICOLON:
                return "Semicolon";
            case KeyEvent.KEYCODE_SPACE:
                return "Space";
            case KeyEvent.KEYCODE_ENTER:
                return "Enter";
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                return "NumpadEnter";
            case KeyEvent.KEYCODE_SHIFT_LEFT:
                return "ShiftLeft";
            case KeyEvent.KEYCODE_SHIFT_RIGHT:
                return "ShiftRight";
            case KeyEvent.KEYCODE_CTRL_LEFT:
                return "ControlLeft";
            case KeyEvent.KEYCODE_CTRL_RIGHT:
                return "ControlRight";
            case KeyEvent.KEYCODE_ALT_LEFT:
                return "AltLeft";
            case KeyEvent.KEYCODE_ALT_RIGHT:
                return "AltRight";
            case KeyEvent.KEYCODE_META_LEFT:
                return "MetaLeft";
            case KeyEvent.KEYCODE_META_RIGHT:
                return "MetaRight";
            case KeyEvent.KEYCODE_ESCAPE:
                return "Escape";
            default:
                return "";
        }
    }

    private boolean isExpectedPreeditChangedSelection(
            int newSelStart,
            int newSelEnd,
            int candidatesStart,
            int candidatesEnd) {
        if (pendingPreeditLengths.isEmpty()
                || candidatesStart < 0
                || candidatesEnd < candidatesStart
                || newSelStart != candidatesEnd
                || newSelEnd != candidatesEnd) {
            return false;
        }
        int composingLength = candidatesEnd - candidatesStart;
        while (!pendingPreeditLengths.isEmpty()) {
            int expectedLength = pendingPreeditLengths.removeFirst();
            if (expectedLength == composingLength) {
                return true;
            }
        }
        return false;
    }

    private void applyPreeditText(String nextText) {
        String normalized = nextText == null ? "" : nextText;
        if (normalized.equals(preeditText)) {
            return;
        }

        preeditText = normalized;
        InputConnection connection = getCurrentInputConnection();
        if (connection == null) {
            pendingPreeditLengths.clear();
            return;
        }

        if (preeditText.isEmpty()) {
            connection.setComposingText("", 1);
            connection.finishComposingText();
            pendingPreeditLengths.clear();
        } else {
            pendingPreeditLengths.addLast(preeditText.length());
            connection.setComposingText(preeditText, 1);
        }
    }

    private void clearPreeditSession() {
        inputGeneration.incrementAndGet();
        boolean hadPreedit = !preeditText.isEmpty();
        preeditText = "";
        pendingPreeditLengths.clear();
        if (hadPreedit) {
            InputConnection connection = getCurrentInputConnection();
            if (connection != null) {
                connection.finishComposingText();
            }
        }
        evaluateJavascript(
                "window.clearPreeditFromAndroid && window.clearPreeditFromAndroid()"
        );
    }

    private void evaluateJavascript(String script) {
        if (webView == null) {
            return;
        }
        webView.post(() -> {
            if (webView != null) {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private void requestInference(String requestBody, int requestId) {
        inferenceExecutor.execute(() -> {
            String responseBody = "";
            String errorMessage = "";
            try {
                responseBody = NativeInference.infer(this, requestBody);
            } catch (Exception error) {
                errorMessage = error.getMessage() == null
                        ? error.getClass().getSimpleName()
                        : error.getMessage();
            }

            String script = "window.handleAndroidInferenceResponse"
                    + " && window.handleAndroidInferenceResponse("
                    + requestId + ","
                    + (errorMessage.isEmpty() ? 200 : 0) + ","
                    + JSONObject.quote(responseBody) + ","
                    + JSONObject.quote(errorMessage)
                    + ")";
            evaluateJavascript(script);
        });
    }

    private void requestPlover(String requestBody, int requestId) {
        ploverExecutor.execute(() -> {
            String responseBody = "";
            String errorMessage = "";
            try {
                responseBody = ploverClient.request(
                        ImePreferences.getPloverHost(this),
                        ImePreferences.getPloverPort(this),
                        requestBody
                );
            } catch (Exception error) {
                errorMessage = error.getMessage() == null
                        ? error.getClass().getSimpleName()
                        : error.getMessage();
            }
            String script = "window.handleAndroidPloverResponse"
                    + " && window.handleAndroidPloverResponse("
                    + requestId + ","
                    + JSONObject.quote(responseBody) + ","
                    + JSONObject.quote(errorMessage)
                    + ")";
            evaluateJavascript(script);
        });
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    private class ImeWebView extends WebView {
        ImeWebView() {
            super(V7ImeService.this);
        }

        @Override
        public boolean dispatchKeyEvent(KeyEvent event) {
            if (event.getAction() != KeyEvent.ACTION_DOWN
                    && event.getAction() != KeyEvent.ACTION_UP) {
                return super.dispatchKeyEvent(event);
            }
            String action = event.getAction() == KeyEvent.ACTION_UP
                    ? "keyup"
                    : "keydown";
            if (dispatchPhysicalKeyToWeb(action, event)) {
                return true;
            }
            return super.dispatchKeyEvent(event);
        }
    }

    private class AndroidBridge {
        @JavascriptInterface
        public boolean hasPloverConfiguration() {
            return !ImePreferences.getPloverHost(V7ImeService.this).isEmpty();
        }

        @JavascriptInterface
        public void setKeyboardHeight(final int heightDp) {
            if (webView == null) {
                return;
            }
            webView.post(() -> {
                if (inputContainer == null) {
                    return;
                }
                inputContainer.getLayoutParams().height = Math.max(
                        dpToPx(MIN_KEYBOARD_HEIGHT_DP),
                        dpToPx(heightDp)
                );
                inputContainer.requestLayout();
            });
        }

        @JavascriptInterface
        public void setPreeditText(String text) {
            String normalized = text == null ? "" : text;
            int generation = inputGeneration.get();
            if (webView != null) {
                webView.post(() -> {
                    if (generation == inputGeneration.get()) {
                        applyPreeditText(normalized);
                    }
                });
            }
        }

        @JavascriptInterface
        public void requestInference(String body, int requestId) {
            V7ImeService.this.requestInference(body, requestId);
        }

        @JavascriptInterface
        public void requestPlover(String body, int requestId) {
            V7ImeService.this.requestPlover(body, requestId);
        }

        @JavascriptInterface
        public void changeInputMethod() {
            if (webView != null) {
                webView.post(() -> {
                    InputMethodManager manager = (InputMethodManager)
                            getSystemService(INPUT_METHOD_SERVICE);
                    if (manager != null) {
                        manager.showInputMethodPicker();
                    }
                });
            }
        }
    }
}
