 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/test-ime/README.md b/test-ime/README.md
new file mode 100644
index 0000000000000000000000000000000000000000..8f7abab8c15b46653e06b54bba1e51ad819015f6
--- /dev/null
+++ b/test-ime/README.md
@@ -0,0 +1,19 @@
+# Test IME
+
+`test-ime` is a minimal Android input method editor demo. The IME view is a `WebView`; the Java service exposes a small bridge and only executes actions requested by `app/src/main/assets/ime.html`.
+
+The demo HTML shows three controls:
+
+- **Add Random Character (A)** appends a random `a`-`z` character to the current preedit/composing text.
+- **Commit Text (S)** commits the current preedit text and clears it.
+- **Change Input Method (D)** opens Android's input method picker.
+
+The HTML can read the screen dimensions, request a keyboard display height, set preedit text, commit preedit text, and react to physical keyboard `A`, `S`, and `D` keystrokes.
+
+## Build
+
+```sh
+ANDROID_HOME=/opt/android-sdk gradle -p test-ime assembleDebug
+```
+
+The committed debug APK is at `app/build/outputs/apk/debug/app-debug.apk`.
diff --git a/test-ime/app/build.gradle b/test-ime/app/build.gradle
new file mode 100644
index 0000000000000000000000000000000000000000..6476e19a40a25319fcc560b45d7230807864127d
--- /dev/null
+++ b/test-ime/app/build.gradle
@@ -0,0 +1,14 @@
+plugins { id "com.android.application" }
+
+android {
+    namespace "com.huynhtrankhanh.testime"
+    compileSdk 35
+
+    defaultConfig {
+        applicationId "com.huynhtrankhanh.testime"
+        minSdk 23
+        targetSdk 35
+        versionCode 1
+        versionName "1.0.0"
+    }
+}
diff --git a/test-ime/app/build/outputs/apk/debug/app-debug.apk b/test-ime/app/build/outputs/apk/debug/app-debug.apk
new file mode 100644
index 0000000000000000000000000000000000000000..a1496f273207da3d924e1c1b6251705132cf26d6
GIT binary patch
literal 15896
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

literal 0
HcmV?d00001

diff --git a/test-ime/app/src/main/AndroidManifest.xml b/test-ime/app/src/main/AndroidManifest.xml
new file mode 100644
index 0000000000000000000000000000000000000000..aef22c9b4c37d057e427059a8f51c67564f53f95
--- /dev/null
+++ b/test-ime/app/src/main/AndroidManifest.xml
@@ -0,0 +1,23 @@
+<?xml version="1.0" encoding="utf-8"?>
+<manifest xmlns:android="http://schemas.android.com/apk/res/android">
+    <uses-permission android:name="android.permission.INTERNET" />
+
+    <application
+        android:allowBackup="false"
+        android:label="@string/app_name"
+        android:supportsRtl="true"
+        android:theme="@style/AppTheme">
+        <service
+            android:name=".TestImeService"
+            android:exported="true"
+            android:label="@string/ime_name"
+            android:permission="android.permission.BIND_INPUT_METHOD">
+            <intent-filter>
+                <action android:name="android.view.InputMethod" />
+            </intent-filter>
+            <meta-data
+                android:name="android.view.im"
+                android:resource="@xml/method" />
+        </service>
+    </application>
+</manifest>
diff --git a/test-ime/app/src/main/assets/ime.html b/test-ime/app/src/main/assets/ime.html
new file mode 100644
index 0000000000000000000000000000000000000000..b3452ea158312ee3de236772dad9e72a8732ac52
--- /dev/null
+++ b/test-ime/app/src/main/assets/ime.html
@@ -0,0 +1,81 @@
+<!doctype html>
+<html lang="en">
+<head>
+  <meta charset="utf-8" />
+  <meta name="viewport" content="width=device-width, initial-scale=1" />
+  <title>Test WebView IME</title>
+  <style>
+    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
+    body { margin: 0; padding: 16px; background: #101827; color: #eef4ff; }
+    .panel { display: grid; gap: 12px; }
+    .buttons { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
+    button { min-height: 56px; border: 0; border-radius: 12px; font-size: 16px; font-weight: 700; background: #3b82f6; color: white; }
+    button:active { transform: translateY(1px); background: #2563eb; }
+    .status { min-height: 24px; font-size: 14px; color: #bfdbfe; }
+    .preedit { padding: 10px; min-height: 24px; border-radius: 10px; background: #1f2937; font-size: 20px; letter-spacing: 0.08em; }
+  </style>
+</head>
+<body>
+  <main class="panel">
+    <div class="status" id="screen"></div>
+    <div class="preedit" id="preedit" aria-live="polite"></div>
+    <div class="buttons">
+      <button id="add">Add Random Character (A)</button>
+      <button id="commit">Commit Text (S)</button>
+      <button id="change">Change Input Method (D)</button>
+    </div>
+  </main>
+  <script>
+    const api = window.AndroidIme;
+    let preedit = '';
+
+    function refresh() {
+      document.getElementById('preedit').textContent = preedit || 'Preedit is empty';
+      if (api) api.setPreeditText(preedit);
+    }
+
+    function randomChar() {
+      return String.fromCharCode(97 + Math.floor(Math.random() * 26));
+    }
+
+    function addRandomCharacter() {
+      preedit += randomChar();
+      refresh();
+    }
+
+    function commitText() {
+      if (api) api.commitPreeditText();
+      preedit = '';
+      refresh();
+    }
+
+    function changeInputMethod() {
+      if (api) api.changeInputMethod();
+    }
+
+    window.handlePhysicalKey = (key) => {
+      if (key === 'a') addRandomCharacter();
+      if (key === 's') commitText();
+      if (key === 'd') changeInputMethod();
+    };
+
+    document.addEventListener('keydown', (event) => {
+      const key = event.key.toLowerCase();
+      if (['a', 's', 'd'].includes(key)) {
+        event.preventDefault();
+        window.handlePhysicalKey(key);
+      }
+    });
+
+    document.getElementById('add').addEventListener('click', addRandomCharacter);
+    document.getElementById('commit').addEventListener('click', commitText);
+    document.getElementById('change').addEventListener('click', changeInputMethod);
+
+    const width = api ? api.getScreenWidth() : window.screen.width;
+    const height = api ? api.getScreenHeight() : window.screen.height;
+    document.getElementById('screen').textContent = `Screen: ${width} × ${height}px`;
+    if (api) api.setKeyboardHeight(240);
+    refresh();
+  </script>
+</body>
+</html>
diff --git a/test-ime/app/src/main/java/com/huynhtrankhanh/testime/TestImeService.java b/test-ime/app/src/main/java/com/huynhtrankhanh/testime/TestImeService.java
new file mode 100644
index 0000000000000000000000000000000000000000..18273e16ba96eda30c3b8f41515d63fdc10361fc
--- /dev/null
+++ b/test-ime/app/src/main/java/com/huynhtrankhanh/testime/TestImeService.java
@@ -0,0 +1,157 @@
+package com.huynhtrankhanh.testime;
+
+import android.annotation.SuppressLint;
+import android.inputmethodservice.InputMethodService;
+import android.os.Build;
+import android.view.KeyEvent;
+import android.view.View;
+import android.view.inputmethod.InputConnection;
+import android.view.inputmethod.InputMethodManager;
+import android.webkit.JavascriptInterface;
+import android.webkit.WebChromeClient;
+import android.webkit.WebSettings;
+import android.webkit.WebView;
+import android.webkit.WebViewClient;
+import android.widget.FrameLayout;
+
+public class TestImeService extends InputMethodService {
+    private FrameLayout inputContainer;
+    private WebView webView;
+    private String preeditText = "";
+
+    @Override
+    public View onCreateInputView() {
+        inputContainer = new FrameLayout(this);
+        webView = new ImeWebView(this);
+        inputContainer.addView(webView, new FrameLayout.LayoutParams(
+                FrameLayout.LayoutParams.MATCH_PARENT,
+                dpToPx(240)
+        ));
+        configureWebView(webView);
+        webView.loadUrl("file:///android_asset/ime.html");
+        return inputContainer;
+    }
+
+    @Override
+    public void onDestroy() {
+        if (webView != null) {
+            webView.destroy();
+            webView = null;
+        }
+        super.onDestroy();
+    }
+
+    @Override
+    public boolean onKeyDown(int keyCode, KeyEvent event) {
+        if (dispatchPhysicalKeyToHtml(event)) {
+            return true;
+        }
+        return super.onKeyDown(keyCode, event);
+    }
+
+    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
+    private void configureWebView(WebView view) {
+        WebSettings settings = view.getSettings();
+        settings.setJavaScriptEnabled(true);
+        settings.setDomStorageEnabled(true);
+        settings.setAllowFileAccess(true);
+        view.setWebViewClient(new WebViewClient());
+        view.setWebChromeClient(new WebChromeClient());
+        view.addJavascriptInterface(new AndroidBridge(), "AndroidIme");
+        view.setFocusable(true);
+        view.setFocusableInTouchMode(true);
+        view.requestFocus();
+        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
+            WebView.setWebContentsDebuggingEnabled(true);
+        }
+    }
+
+    private boolean dispatchPhysicalKeyToHtml(KeyEvent event) {
+        if (event.getAction() != KeyEvent.ACTION_DOWN || webView == null) {
+            return false;
+        }
+        String key;
+        if (event.getKeyCode() == KeyEvent.KEYCODE_A) {
+            key = "a";
+        } else if (event.getKeyCode() == KeyEvent.KEYCODE_S) {
+            key = "s";
+        } else if (event.getKeyCode() == KeyEvent.KEYCODE_D) {
+            key = "d";
+        } else {
+            return false;
+        }
+        webView.evaluateJavascript("window.handlePhysicalKey && window.handlePhysicalKey('" + key + "')", null);
+        return true;
+    }
+
+    private int dpToPx(int dp) {
+        return Math.round(dp * getResources().getDisplayMetrics().density);
+    }
+
+    private class ImeWebView extends WebView {
+        ImeWebView(TestImeService context) {
+            super(context);
+        }
+
+        @Override
+        public boolean dispatchKeyEvent(KeyEvent event) {
+            if (dispatchPhysicalKeyToHtml(event)) {
+                return true;
+            }
+            return super.dispatchKeyEvent(event);
+        }
+    }
+
+    private class AndroidBridge {
+        @JavascriptInterface
+        public int getScreenWidth() {
+            return getResources().getDisplayMetrics().widthPixels;
+        }
+
+        @JavascriptInterface
+        public int getScreenHeight() {
+            return getResources().getDisplayMetrics().heightPixels;
+        }
+
+        @JavascriptInterface
+        public void setKeyboardHeight(final int heightDp) {
+            if (webView == null) {
+                return;
+            }
+            webView.post(() -> {
+                if (inputContainer == null) {
+                    return;
+                }
+                inputContainer.getLayoutParams().height = dpToPx(Math.max(120, heightDp));
+                inputContainer.requestLayout();
+            });
+        }
+
+        @JavascriptInterface
+        public void setPreeditText(String text) {
+            preeditText = text == null ? "" : text;
+            InputConnection connection = getCurrentInputConnection();
+            if (connection != null) {
+                connection.setComposingText(preeditText, 1);
+            }
+        }
+
+        @JavascriptInterface
+        public void commitPreeditText() {
+            InputConnection connection = getCurrentInputConnection();
+            if (connection != null) {
+                connection.commitText(preeditText, 1);
+                connection.finishComposingText();
+            }
+            preeditText = "";
+        }
+
+        @JavascriptInterface
+        public void changeInputMethod() {
+            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
+            if (imm != null) {
+                imm.showInputMethodPicker();
+            }
+        }
+    }
+}
diff --git a/test-ime/app/src/main/res/values/strings.xml b/test-ime/app/src/main/res/values/strings.xml
new file mode 100644
index 0000000000000000000000000000000000000000..d1542bc04cf5cef2f5792d1060c070c72be3f7e2
--- /dev/null
+++ b/test-ime/app/src/main/res/values/strings.xml
@@ -0,0 +1,4 @@
+<resources>
+    <string name="app_name">Test IME</string>
+    <string name="ime_name">Test WebView IME</string>
+</resources>
diff --git a/test-ime/app/src/main/res/values/styles.xml b/test-ime/app/src/main/res/values/styles.xml
new file mode 100644
index 0000000000000000000000000000000000000000..27adb98d5bc28ffd1b8cf50fcba9a8e6550ba365
--- /dev/null
+++ b/test-ime/app/src/main/res/values/styles.xml
@@ -0,0 +1,3 @@
+<resources>
+    <style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar" />
+</resources>
diff --git a/test-ime/app/src/main/res/xml/method.xml b/test-ime/app/src/main/res/xml/method.xml
new file mode 100644
index 0000000000000000000000000000000000000000..22419a107c98aec1e1dbcbebdceb398b01169923
--- /dev/null
+++ b/test-ime/app/src/main/res/xml/method.xml
@@ -0,0 +1,7 @@
+<?xml version="1.0" encoding="utf-8"?>
+<input-method xmlns:android="http://schemas.android.com/apk/res/android"
+    android:settingsActivity="">
+    <subtype
+        android:imeSubtypeLocale="en_US"
+        android:imeSubtypeMode="keyboard" />
+</input-method>
diff --git a/test-ime/build.gradle b/test-ime/build.gradle
new file mode 100644
index 0000000000000000000000000000000000000000..48d2fa10af0d11f9ed6d2e3309b4c6c59395ff34
--- /dev/null
+++ b/test-ime/build.gradle
@@ -0,0 +1,3 @@
+plugins {
+    id "com.android.application" version "8.7.3" apply false
+}
diff --git a/test-ime/settings.gradle b/test-ime/settings.gradle
new file mode 100644
index 0000000000000000000000000000000000000000..fb3e52e36566f27855acac9d8199492b03f2a9bd
--- /dev/null
+++ b/test-ime/settings.gradle
@@ -0,0 +1,12 @@
+pluginManagement {
+    repositories {
+        google()
+        mavenCentral()
+        gradlePluginPortal()
+    }
+}
+
+dependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }
+
+rootProject.name = "TestIme"
+include ":app"
 
EOF
)
