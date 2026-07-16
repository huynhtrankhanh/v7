package com.huynhtrankhanh.testime;

import android.annotation.SuppressLint;
import android.inputmethodservice.InputMethodService;
import android.os.Build;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

public class TestImeService extends InputMethodService {
    private FrameLayout inputContainer;
    private WebView webView;
    private String preeditText = "";

    @Override
    public View onCreateInputView() {
        inputContainer = new FrameLayout(this);
        webView = new ImeWebView(this);
        inputContainer.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                dpToPx(240)
        ));
        configureWebView(webView);
        webView.loadUrl("file:///android_asset/ime.html");
        return inputContainer;
    }

    @Override
    public void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (dispatchPhysicalKeyToHtml(event)) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        view.setWebViewClient(new WebViewClient());
        view.setWebChromeClient(new WebChromeClient());
        view.addJavascriptInterface(new AndroidBridge(), "AndroidIme");
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.requestFocus();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }

    private boolean dispatchPhysicalKeyToHtml(KeyEvent event) {
        if (event.getAction() != KeyEvent.ACTION_DOWN || webView == null) {
            return false;
        }
        String key;
        if (event.getKeyCode() == KeyEvent.KEYCODE_A) {
            key = "a";
        } else if (event.getKeyCode() == KeyEvent.KEYCODE_S) {
            key = "s";
        } else if (event.getKeyCode() == KeyEvent.KEYCODE_D) {
            key = "d";
        } else {
            return false;
        }
        webView.evaluateJavascript("window.handlePhysicalKey && window.handlePhysicalKey('" + key + "')", null);
        return true;
    }

    private int dpToPx(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    private class ImeWebView extends WebView {
        ImeWebView(TestImeService context) {
            super(context);
        }

        @Override
        public boolean dispatchKeyEvent(KeyEvent event) {
            if (dispatchPhysicalKeyToHtml(event)) {
                return true;
            }
            return super.dispatchKeyEvent(event);
        }
    }

    private class AndroidBridge {
        @JavascriptInterface
        public int getScreenWidth() {
            return getResources().getDisplayMetrics().widthPixels;
        }

        @JavascriptInterface
        public int getScreenHeight() {
            return getResources().getDisplayMetrics().heightPixels;
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
                inputContainer.getLayoutParams().height = dpToPx(Math.max(120, heightDp));
                inputContainer.requestLayout();
            });
        }

        @JavascriptInterface
        public void setPreeditText(String text) {
            preeditText = text == null ? "" : text;
            InputConnection connection = getCurrentInputConnection();
            if (connection != null) {
                connection.setComposingText(preeditText, 1);
            }
        }

        @JavascriptInterface
        public void commitPreeditText() {
            InputConnection connection = getCurrentInputConnection();
            if (connection != null) {
                connection.commitText(preeditText, 1);
                connection.finishComposingText();
            }
            preeditText = "";
        }

        @JavascriptInterface
        public void changeInputMethod() {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.showInputMethodPicker();
            }
        }
    }
}
