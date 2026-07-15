# Test IME

`test-ime` is a minimal Android input method editor demo. The IME view is a `WebView`; the Java service exposes a small bridge and only executes actions requested by `app/src/main/assets/ime.html`.

The demo HTML shows three controls:

- **Add Random Character (A)** appends a random `a`-`z` character to the current preedit/composing text.
- **Commit Text (S)** commits the current preedit text and clears it.
- **Change Input Method (D)** opens Android's input method picker.

The HTML can read the screen dimensions, request a keyboard display height, set preedit text, commit preedit text, and react to physical keyboard `A`, `S`, and `D` keystrokes.

## Build

```sh
ANDROID_HOME=/opt/android-sdk gradle -p test-ime assembleDebug
```

The committed debug APK is at `app/build/outputs/apk/debug/app-debug.apk`.
