package com.huynhtrankhanh.v7ime;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class DictionaryManagementActivity extends Activity {
    private static final String LOG_TAG = "V7Dictionary";
    private static final int CHOOSE_DICTIONARY_REQUEST = 1;
    private static final int SAVE_DICTIONARY_REQUEST = 2;

    private final ExecutorService ioExecutor =
            Executors.newSingleThreadExecutor();
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingSaveContent = "";

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle(R.string.manage_dictionaries);

        webView = new WebView(this);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new DictionaryWebChromeClient());
        webView.addJavascriptInterface(
                new DictionaryAndroidBridge(),
                "AndroidDictionary"
        );
        webView.loadUrl("file:///android_asset/dictionary.html?dictionary-management=1");
    }

    @Override
    protected void onDestroy() {
        ioExecutor.shutdownNow();
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == CHOOSE_DICTIONARY_REQUEST) {
            ValueCallback<Uri[]> callback = filePathCallback;
            filePathCallback = null;
            if (callback != null) {
                callback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(
                                resultCode,
                                data
                        )
                );
            }
        } else if (requestCode == SAVE_DICTIONARY_REQUEST) {
            if (resultCode == RESULT_OK
                    && data != null
                    && data.getData() != null) {
                writeDictionary(data.getData(), pendingSaveContent);
            }
            pendingSaveContent = "";
        }
    }

    private void requestPlover(String requestBody, int requestId) {
        BundledStrippedPloverRuntime.get(this).request(
                requestBody,
                (responseBody, errorMessage) -> {
                    String script = "window.handleAndroidPloverResponse"
                            + " && window.handleAndroidPloverResponse("
                            + requestId + ","
                            + JSONObject.quote(responseBody) + ","
                            + JSONObject.quote(errorMessage)
                            + ")";
                    evaluateJavascript(script);
                }
        );
    }

    private void chooseDictionaryDestination(
            String filename,
            String content,
            String mimeType) {
        pendingSaveContent = content == null ? "" : content;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(
                        mimeType == null || mimeType.isEmpty()
                                ? "application/octet-stream"
                                : mimeType
                )
                .putExtra(
                        Intent.EXTRA_TITLE,
                        filename == null || filename.isEmpty()
                                ? "dictionary.json"
                                : filename
                );
        startActivityForResult(intent, SAVE_DICTIONARY_REQUEST);
    }

    private void writeDictionary(Uri destination, String content) {
        ioExecutor.execute(() -> {
            String errorMessage = "";
            try (OutputStream output =
                         getContentResolver().openOutputStream(destination)) {
                if (output == null) {
                    throw new IOException("Destination is unavailable");
                }
                output.write(content.getBytes(StandardCharsets.UTF_8));
            } catch (IOException error) {
                errorMessage = error.getMessage() == null
                        ? error.getClass().getSimpleName()
                        : error.getMessage();
                Log.e(LOG_TAG, "Unable to save dictionary", error);
            }

            String finalErrorMessage = errorMessage;
            runOnUiThread(() -> {
                String message = finalErrorMessage.isEmpty()
                        ? getString(R.string.dictionary_saved)
                        : getString(
                                R.string.dictionary_save_failed,
                                finalErrorMessage
                        );
                Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            });
        });
    }

    private void evaluateJavascript(String script) {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private class DictionaryWebChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(
                WebView target,
                ValueCallback<Uri[]> callback,
                FileChooserParams params) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;
            try {
                startActivityForResult(
                        params.createIntent(),
                        CHOOSE_DICTIONARY_REQUEST
                );
                return true;
            } catch (RuntimeException error) {
                filePathCallback = null;
                callback.onReceiveValue(null);
                return false;
            }
        }
    }

    private class DictionaryAndroidBridge {
        @JavascriptInterface
        public boolean hasPloverConfiguration() {
            return true;
        }

        @JavascriptInterface
        public void requestPlover(String body, int requestId) {
            DictionaryManagementActivity.this.requestPlover(body, requestId);
        }

        @JavascriptInterface
        public void close() {
            runOnUiThread(DictionaryManagementActivity.this::finish);
        }

        @JavascriptInterface
        public void saveDictionaryFile(
                String filename,
                String content,
                String mimeType) {
            runOnUiThread(() -> chooseDictionaryDestination(
                    filename,
                    content,
                    mimeType
            ));
        }
    }
}
