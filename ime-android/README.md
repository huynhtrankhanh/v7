# V7 IME for Android

`ime-android` packages the V7 WebUI as an Android input method with application ID
`com.huynhtrankhanh.v7ime`.

## Architecture

- The root Vite build remains the source of truth for the keyboard UI. Android's
  `syncWebUi` Gradle task builds and packages `static/index.html` and
  `static/script.js`.
- `V7ImeService` hosts that UI in a `WebView`. The WebUI detects
  `window.AndroidIme`, enables stripped display mode, and mirrors its current
  rendered text into Android composing text.
- Hardware key-down and key-up events are captured by the IME and forwarded to
  the WebUI as browser `KeyboardEvent`s. This preserves multi-key steno chords.
- Inference requests go through the native bridge. Android reads the configured
  endpoint and optional HTTP Basic credentials, makes the request, and returns
  the JSON response to the WebUI. This avoids file-origin CORS restrictions and
  keeps credentials out of WebUI storage.
- Moving the cursor or changing editors finishes the active composition and
  clears the WebUI buffer, so already-entered text remains in the editor while a
  new composing session starts cleanly.

## Settings

Open **V7 IME** from the launcher or tap its settings entry in Android's
keyboard settings. The native settings activity includes:

- inference server URL (a base URL or complete `/infer` endpoint);
- optional HTTP Basic username and password;
- shortcuts to enable V7 IME and open the input-method picker.

An `http://` URL is supported for local development. Prefer HTTPS whenever
credentials are configured.

## Build

The Android build invokes the root WebUI build. Install the root JavaScript
dependencies first and use Gradle 8.9:

```sh
npm ci
gradle -p ime-android assembleDebug
```

The APK is written to:

```text
ime-android/app/build/outputs/apk/debug/app-debug.apk
```
