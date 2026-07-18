# Test IME

`test-ime` is a minimal Android input method editor demo. It exists to exercise Android IME composing/preedit behavior with a tiny WebView-powered keyboard.

The Android service owns the real `InputConnection` interactions. The keyboard UI is `app/src/main/assets/ime.html`, loaded into a `WebView`, and it can only affect the target editor through the small JavaScript bridge exposed by `TestImeService`.

## User-visible behavior

The demo keyboard shows:

- **Screen size status**: displays the current screen width and height reported by Android.
- **Preedit status**: displays the current in-keyboard preedit string, or `Preedit is empty` when no composing text is active.
- **Add Random Character (A)**: appends a random `a`-`z` character to the current preedit string and sends the whole string to the target editor as composing text.
- **Commit Text (S)**: commits the current preedit string to the target editor, finishes composing text, and clears the in-keyboard preedit display.
- **Change Input Method (D)**: opens Android's input method picker.

The same actions are available from physical keyboard keys while Test IME is active:

- `A` runs **Add Random Character**.
- `S` runs **Commit Text**.
- `D` runs **Change Input Method**.

## Preedit and cursor behavior

Test IME keeps a Java-side copy of the active preedit text so it can decide when the composing session has become invalid.

The preedit is cleared in all of these cases:

1. **Input starts or finishes**: `onStartInput` and `onFinishInput` reset any previous composing session.
2. **The user commits text**: the bridge commits the current preedit, calls `finishComposingText`, and empties the Java-side preedit copy.
3. **The cursor or selection moves outside the composing region**: Android reports the movement through `onUpdateSelection`, and Test IME finishes composing text.
4. **The cursor or selection moves inside the composing region for any reason other than Test IME changing the preedit**: this explicitly handles cursor movement within the preedit block, so manually repositioning the caret inside composing text clears the preedit instead of leaving stale keyboard state behind.

Selection updates are preserved only when they are clearly caused by Test IME changing the preedit. Because the HTML can grow or shrink the preedit quickly, the service counts pending non-empty `setComposingText` calls and then verifies Android's next reported selection against the current preedit state. Test IME keeps the preedit only if there is a pending preedit update, Android reports a composing region whose length exactly matches the current Java-side preedit string, and the selection is collapsed at the end of that composing region. Any actual cursor movement, including movement inside the preedit block, clears the preedit.

When Java clears the preedit because of lifecycle or cursor movement, it also calls `window.clearPreeditFromAndroid()` in the WebView so the HTML display matches the Android composing state.

## Implementation details

### Android service

`app/src/main/java/com/huynhtrankhanh/testime/TestImeService.java` implements the IME service.

- `onCreateInputView` creates a `FrameLayout`, adds the WebView at a default height of 240 dp, configures JavaScript support, and loads `file:///android_asset/ime.html`.
- `onEvaluateInputViewShown` always returns `true` so Android shows the input view.
- `onStartInput` and `onFinishInput` call `clearPreeditSession` to reset stale composing state across editor changes.
- `onUpdateSelection` compares Android's old and new selection positions with the composing region (`candidatesStart`/`candidatesEnd`). It preserves the preedit only for a pending preedit-change update whose composing-region length matches the current preedit text and whose selection is collapsed at the composing-region end. Other cursor movement clears the preedit, whether the new selection is outside or inside the composing region.
- `onKeyDown` and the custom `ImeWebView.dispatchKeyEvent` route physical `A`, `S`, and `D` key-down events into the HTML handler.
- `clearPreeditSession` empties Java state, cancels any pending preedit-change selection updates, calls `finishComposingText`, and asks the WebView to clear its visible preedit.

### JavaScript bridge

The nested `AndroidBridge` class exposes these methods to the WebView as `window.AndroidIme`:

- `getScreenWidth()` and `getScreenHeight()` return display dimensions in pixels.
- `setKeyboardHeight(heightDp)` resizes the input view, with a 120 dp minimum.
- `setPreeditText(text)` stores the new preedit string and calls `InputConnection.setComposingText(text, 1)`. For non-empty text, it increments the count of pending preedit-change selection updates so rapid grow/shrink/grow sequences can still be recognized when Android reports the resulting composing span.
- `commitPreeditText()` commits the stored preedit string, finishes composing text, clears Java state, and cancels any pending preedit-change selection updates.
- `changeInputMethod()` opens Android's input method picker.

### WebView keyboard

`app/src/main/assets/ime.html` implements the keyboard UI and behavior.

- It stores the current preedit in a JavaScript `preedit` variable.
- `refresh()` redraws the preedit status and calls `AndroidIme.setPreeditText(preedit)` when the bridge is available.
- `addRandomCharacter()` appends a random lowercase ASCII letter and refreshes composing text.
- `commitText()` calls `AndroidIme.commitPreeditText()`, clears the JavaScript preedit, and refreshes the display.
- `changeInputMethod()` calls `AndroidIme.changeInputMethod()`.
- `window.handlePhysicalKey()` maps `a`, `s`, and `d` to the same actions as the visible buttons.
- `window.clearPreeditFromAndroid()` lets the service clear the WebView display when Android-side lifecycle or cursor movement cancels the composing session.

## Build

```sh
ANDROID_HOME=/opt/android-sdk gradle -p test-ime assembleDebug
```

The debug APK is written to `test-ime/app/build/outputs/apk/debug/app-debug.apk`.
