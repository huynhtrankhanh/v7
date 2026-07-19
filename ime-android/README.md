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
- Inference requests go through JNI to the bundled `inference-rs` and KenLM
  code. No inference request leaves the device.
- The language model is not bundled. Android retains a Storage Access Framework
  document grant and passes its seekable file descriptor directly to KenLM,
  which memory-maps it without copying the model into app-private storage.
- Stripped Plover uses a separate native TCP bridge and is the only feature
  that uses server settings.
- Moving the cursor or changing editors finishes the active composition and
  clears the WebUI buffer, so already-entered text remains in the editor while a
  new composing session starts cleanly.

## Settings

Open **V7 IME** from the launcher or tap its settings entry in Android's
keyboard settings. The native settings activity includes:

- a local `lm.binary` document selected with Android's Storage Access
  Framework;
- optional Stripped Plover host and TCP port;
- an option to save the complete APK build source as `v7-ime-source.zip`;
- shortcuts to enable V7 IME and open the input-method picker.

The source ZIP contains this repository plus the exact pinned KenLM checkout.
It is offered under GPL-3.0-or-later and retains KenLM's LGPL and other
third-party notices. It intentionally excludes user language models.

## Build

The Android build invokes the root WebUI build, compiles Rust/KenLM for Android,
and creates the source ZIP asset. Install the root JavaScript dependencies,
Rust 1.88, `cargo-ndk`, Android NDK 27.2.12479018, and Gradle 8.9:

```sh
npm ci
rustup target add \
  aarch64-linux-android armv7-linux-androideabi \
  x86_64-linux-android i686-linux-android
cargo install cargo-ndk --version 4.1.2 --locked
ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018" \
  gradle -p ime-android assembleDebug
```

The APK is written to:

```text
ime-android/app/build/outputs/apk/debug/app-debug.apk
```
