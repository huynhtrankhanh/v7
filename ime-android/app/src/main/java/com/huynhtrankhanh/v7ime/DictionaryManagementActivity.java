package com.huynhtrankhanh.v7ime;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.content.pm.PackageManager;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
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
    private static final int NOTIFICATION_PERMISSION_REQUEST = 3;

    private final ExecutorService ioExecutor =
            Executors.newSingleThreadExecutor();
    private WebView webView;
    private FrameLayout rootView;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingSaveContent = "";
    private Uri selectedDictionaryUri;

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle(R.string.manage_dictionaries);

        rootView = new FrameLayout(this);
        webView = new WebView(this);
        rootView.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(rootView);
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
        BundledStrippedPloverRuntime.get(this).attachTo(rootView);
        webView.loadUrl("file:///android_asset/dictionary.html?dictionary-management=1");
    }

    @Override
    protected void onDestroy() {
        if (rootView != null) {
            BundledStrippedPloverRuntime.get(this).detachFrom(rootView);
            rootView = null;
        }
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
            Uri[] selected = WebChromeClient.FileChooserParams.parseResult(
                    resultCode,
                    data
            );
            selectedDictionaryUri = selected != null && selected.length > 0
                    ? selected[0]
                    : null;
            if (selectedDictionaryUri != null && data != null) {
                try {
                    getContentResolver().takePersistableUriPermission(
                            selectedDictionaryUri,
                            data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION
                    );
                } catch (SecurityException ignored) {
                    // The private staging copy is made while the transient
                    // grant is still valid; not all providers persist grants.
                }
            }
            if (callback != null) {
                callback.onReceiveValue(selected);
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

    private void requestImportNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            runOnUiThread(() -> requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    NOTIFICATION_PERMISSION_REQUEST
            ));
        }
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
                // Document providers do not agree on MIME types for .py and
                // .json files. Filtering on an exact MIME allow-list hides
                // valid dictionaries from some Android file pickers, so let
                // the user choose any openable document. The web UI still
                // advertises and processes only dictionary formats.
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("*/*")
                        .addFlags(
                                Intent.FLAG_GRANT_READ_URI_PERMISSION
                                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                        );
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                startActivityForResult(
                        intent,
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

        @JavascriptInterface
        public String enqueueSelectedDictionaryImport(
                String name,
                String type,
                boolean merge) {
            requestImportNotificationPermission();
            try {
                String taskId = DictionaryImportManager.enqueueSelectedDocument(
                        DictionaryManagementActivity.this,
                        name == null ? "" : name,
                        type == null ? "" : type,
                        selectedDictionaryUri,
                        merge
                );
                selectedDictionaryUri = null;
                return new JSONObject()
                        .put("id", taskId)
                        .put("error", "")
                        .toString();
            } catch (Exception error) {
                try {
                    return new JSONObject()
                            .put("id", "")
                            .put("error", DictionaryImportManager.messageFor(error))
                            .toString();
                } catch (Exception impossible) {
                    return "{\"id\":\"\",\"error\":\"Import could not be scheduled\"}";
                }
            }
        }

        @JavascriptInterface
        public String getDictionaryImportState(String taskId) {
            return DictionaryImportManager.getState(
                    DictionaryManagementActivity.this,
                    taskId == null ? "" : taskId
            );
        }

    }
}
