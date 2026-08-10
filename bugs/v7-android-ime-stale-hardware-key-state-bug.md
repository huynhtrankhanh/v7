# Android IME can stop updating after Add Translation because WebUI chord state survives focus/lifecycle transitions

## Summary

On Android, after using the Stripped Plover **Add Translation** flow and returning to the V7 keyboard, the keyboard can appear to stop updating or behave as if an older/stale keyboard instance is still active.

The current evidence points to a **hardware-key state synchronization bug**, not to multiple Stripped Plover runtimes or multiple active IME instances.

V7 currently maintains hardware-key state in two places:

1. **Android (`V7ImeService`)**
   - `webCapturedHardwareKeys`
   - `editorPassedHardwareKeys`
   - `HardwareKeyActionResolver`

2. **WebUI (`src/main.ts` / `KeyboardStrokeTracker`)**
   - `heldKeys`
   - `strokeKeys`
   - `pressedQwertyKeys` for visual state

When focus moves from the IME WebView into the native `PloverCommandActivity`, Android can clear its own captured-key state and stop forwarding subsequent key events to the WebView. However, the WebUI's `KeyboardStrokeTracker` is not reset. If the transition happens between a `keydown` and its matching `keyup`, the WebUI can permanently retain a "ghost" held key.

Once that happens, later chords may never complete because `KeyboardStrokeTracker.keyUp()` refuses to emit a stroke while any held key remains. The visible pressed-key state may already have been cleared, making the keyboard look frozen, lagged, or stale even though the underlying problem is an orphaned key in the WebUI state machine.

This can be triggered by the Add Translation workflow because native controls in `PloverCommandActivity` intentionally take hardware-key ownership away from the IME.

---

## Affected area

Repository:

- `huynhtrankhanh/v7`

Observed after merge of:

- PR #144 — Android Stripped Plover dictionary RPC fixes

Relevant Android files:

- `ime-android/app/src/main/java/com/huynhtrankhanh/v7ime/V7ImeService.java`
- `ime-android/app/src/main/java/com/huynhtrankhanh/v7ime/PloverCommandActivity.java`
- `ime-android/app/src/main/java/com/huynhtrankhanh/v7ime/PloverCommandFocusState.java`
- `ime-android/app/src/main/java/com/huynhtrankhanh/v7ime/BundledStrippedPloverRuntime.java`

Relevant WebUI files:

- `src/main.ts`
- `src/webCore.ts`

The merged V7 revision where this was investigated:

- `6b519530e16b3de861bfae7c0563eff91be76892`

---

## User-visible symptoms

After adding or replacing a Stripped Plover dictionary entry through the Android Add Translation UI, returning to the keyboard can result in one or more of the following:

- the on-screen keyboard stops reflecting new key presses;
- new steno chords no longer produce output;
- the keyboard appears to be "lagging";
- the UI appears to show state from an older keyboard session;
- reopening or switching away from the keyboard may temporarily recover it;
- Stripped Plover itself may still be responsive to RPCs, while physical keyboard input no longer produces V7/Plover strokes.

The failure can look like multiple keyboard instances are alive, but the current implementation does not strongly support that explanation.

---

## Expected behavior

Opening Add Translation, interacting with native controls, and returning to the IME must not leave any stale hardware-key state behind.

After any focus or input-view ownership transition:

- no key should remain logically held unless Android is still receiving that physical key as held;
- the next complete chord should be recognized normally;
- the on-screen pressed-key display should match the logical chord tracker;
- V7 and Stripped Plover input should continue without requiring the user to restart or switch the IME.

---

## Reproduction

A timing-sensitive reproduction is expected to be the most reliable because the bug requires a `keydown` / `keyup` pair to be split across an ownership transition.

### Reproduction A: focus transfer during a held key

1. Enable the V7 Android IME.
2. Open an editor where the V7 keyboard is visible.
3. Enter the Stripped Plover Add Translation flow.
4. Arrange for a hardware key to be pressed while the IME WebView still owns input.
5. Before the matching `keyup` reaches the WebView, move focus to a native control in `PloverCommandActivity`, for example:
   - a dictionary `RadioButton`;
   - an Add/Replace button;
   - a native status/focusable control.
6. Release the key.
7. Close the command activity and return to the editor.
8. Type a normal V7/steno chord.

### Expected

The chord is emitted normally.

### Actual

The chord may never be emitted because the old key remains in `KeyboardStrokeTracker.heldKeys`.

---

## Likely real-world reproduction

A user does not need to intentionally hold a key across a focus boundary. Fast keyboard navigation, command shortcuts, focus changes, Android-delivered key ordering, or switching between the IME and native Add Translation controls can naturally create this sequence.

The bug is therefore likely intermittent from the user's point of view even though the underlying state-machine failure is deterministic once a keyup is lost.

---

## Technical root cause

### 1. The WebUI has a logical chord tracker separate from the visual pressed-key set

`KeyboardStrokeTracker` in `src/webCore.ts` keeps two internal sets:

```ts
private heldKeys = new Set<string>();
private strokeKeys = new Set<string>();
```

A stroke is only emitted from `keyUp()` when all held keys have been released:

```ts
keyUp(key: string): string | null {
  const mapped = mapKeyUnique(key);
  if (!mapped) return null;

  this.heldKeys.delete(mapped);

  if (this.heldKeys.size !== 0 || this.strokeKeys.size === 0) {
    return null;
  }

  const stroke = serializeStrokeKeys(this.strokeKeys);
  this.strokeKeys = new Set<string>();
  return stroke;
}
```

There is currently no public reset API for this state.

---

### 2. Existing WebUI cleanup only clears the visual key state

`src/main.ts` has:

```ts
function clearPressedQwertyKeys(): void {
  if (pressedQwertyKeys.size === 0) return;
  pressedQwertyKeys.clear();
  updateKeyboardLayout();
}
```

and calls it on events such as:

```ts
window.addEventListener("blur", clearPressedQwertyKeys);
```

This clears only `pressedQwertyKeys`, which drives the keyboard visualization.

It does **not** clear:

- `KeyboardStrokeTracker.heldKeys`
- `KeyboardStrokeTracker.strokeKeys`

Therefore the UI can visually show "no keys pressed" while the chord state machine still believes one or more keys are down.

That mismatch explains the "stale instance" appearance.

---

### 3. Android deliberately stops forwarding keys when native command controls take focus

`PloverCommandActivity` marks native controls as owning focus.

For example, non-`EditText` focusable controls set:

```java
PloverCommandFocusState.setNativeControlFocused(true);
```

`V7ImeService.dispatchHardwareKeyEvent()` then contains this path:

```java
if (PloverCommandFocusState.shouldPassHardwareKeyToActivity(event)) {
    hardwareKeyActionResolver.reset();
    webCapturedHardwareKeys.clear();
    editorPassedHardwareKeys.clear();
    return false;
}
```

This is reasonable for native command navigation, but it creates a state boundary:

- Android forgets which keys were captured by the WebView;
- future key events may be routed to the Activity;
- the WebView receives no explicit instruction to clear its logical key tracker.

If a WebView `keydown` was already delivered but its corresponding `keyup` is subsequently routed elsewhere, the WebUI is left with an orphaned held key.

---

## Concrete failure sequence

Example:

```text
Physical key Q goes down

Android V7ImeService
  -> forwards keydown to the IME WebView

WebUI
  -> KeyboardStrokeTracker.heldKeys = { "#" }
  -> KeyboardStrokeTracker.strokeKeys = { "#" }

Focus moves to a native Add Translation control

PloverCommandFocusState.nativeControlFocused = true

Physical Q goes up

Android V7ImeService
  -> shouldPassHardwareKeyToActivity(...) == true
  -> clears webCapturedHardwareKeys
  -> returns false
  -> keyup is NOT sent back to the IME WebView

WebUI
  -> never sees keyup
  -> heldKeys still contains "#"

User returns to editor and presses another chord

WebUI
  -> new keys are added and removed
  -> old "#" remains in heldKeys
  -> heldKeys.size !== 0
  -> keyUp() returns null
  -> no stroke is emitted
```

At this point the visible keyboard may already have been cleared by `clearPressedQwertyKeys()`, so the failure looks like a frozen or stale keyboard rather than a stuck key.

---

## Why multiple Stripped Plover instances are unlikely to be the primary cause

`BundledStrippedPloverRuntime` is process-wide singleton state:

```java
private static BundledStrippedPloverRuntime instance;

static synchronized BundledStrippedPloverRuntime get(Context context) {
    if (instance == null) {
        instance = new BundledStrippedPloverRuntime(
                context.getApplicationContext()
        );
    }
    return instance;
}
```

The IME input WebView also destroys the previous view before creating a replacement:

```java
if (webView != null) {
    webView.stopLoading();
    webView.removeJavascriptInterface("AndroidIme");
    webView.destroy();
}

webView = new ImeWebView();
```

There are intentionally two WebViews in the architecture:

1. the visible IME WebUI;
2. the hidden bundled Stripped Plover runtime WebView.

That is expected and is not itself evidence of duplicated keyboard instances.

The current failure is better explained by logical key state surviving a focus/lifecycle boundary.

---

## Additional lifecycle gaps

The same class of bug can occur outside Add Translation because several Android-side reset paths do not reset the WebUI `KeyboardStrokeTracker`.

### `onStartInput()`

Android resets:

- preedit session;
- `HardwareKeyActionResolver`;
- `webCapturedHardwareKeys`;
- `editorPassedHardwareKeys`.

But it does not explicitly reset the WebUI chord tracker.

### `onFinishInput()`

The same mismatch exists.

### `clearPreeditFromAndroid()`

The JS function resets:

- inference;
- Stripped Plover request generation;
- Plover preedit tracking;
- Stripped Plover translator state;
- the text buffer;
- candidates;
- raw mode.

But it does not reset `KeyboardStrokeTracker`.

### mode changes

`handleAndroidStenoModeChanged()` and `handleAndroidEditorModeChanged()` clear the visual pressed-key state, but not the logical chord tracker.

These are all potential stale-state boundaries.

---

## Proposed fix

### 1. Add an explicit reset method to `KeyboardStrokeTracker`

In `src/webCore.ts`:

```ts
export class KeyboardStrokeTracker {
  private heldKeys = new Set<string>();
  private strokeKeys = new Set<string>();

  reset(): void {
    this.heldKeys.clear();
    this.strokeKeys.clear();
  }

  // existing keyDown/keyUp...
}
```

---

### 2. Replace visual-only cleanup with a full hardware-input reset

In `src/main.ts`, introduce one canonical reset function:

```ts
function resetHardwareKeyboardState(): void {
  keyboardStrokeTracker.reset();

  if (pressedQwertyKeys.size !== 0) {
    pressedQwertyKeys.clear();
    updateKeyboardLayout();
  }
}
```

Avoid maintaining separate "visual reset" and "logical reset" semantics unless there is a very specific reason.

---

### 3. Reset on browser/WebView focus loss

Replace or extend:

```ts
window.addEventListener("blur", clearPressedQwertyKeys);
```

with:

```ts
window.addEventListener("blur", resetHardwareKeyboardState);
```

Also use the full reset when the document becomes hidden:

```ts
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resetHardwareKeyboardState();
  }
});
```

---

### 4. Reset on Android editor and steno-mode transitions

Update:

```ts
window.handleAndroidStenoModeChanged = ...
window.handleAndroidEditorModeChanged = ...
```

to use the full hardware-key reset.

These transitions can invalidate any in-progress physical chord and should not preserve half a chord.

---

### 5. Reset when Android clears its own captured-key ownership

This is the most important part.

When `V7ImeService` takes this path:

```java
if (PloverCommandFocusState.shouldPassHardwareKeyToActivity(event)) {
    hardwareKeyActionResolver.reset();
    webCapturedHardwareKeys.clear();
    editorPassedHardwareKeys.clear();
    return false;
}
```

Android should also tell the current IME WebView that any partially captured chord has been invalidated.

For example, expose:

```ts
window.resetHardwareKeyboardStateFromAndroid = () => {
  resetHardwareKeyboardState();
};
```

and call it from Java before or when clearing `webCapturedHardwareKeys`:

```java
evaluateJavascript(
    "window.resetHardwareKeyboardStateFromAndroid"
        + " && window.resetHardwareKeyboardStateFromAndroid()"
);
```

Naming is flexible; the important invariant is:

> Whenever Android discards captured hardware-key ownership, the WebUI must discard the corresponding logical chord state too.

---

### 6. Reset on input session boundaries

Call the same WebUI reset from:

- `onStartInput()`
- `onFinishInput()`
- any input-view recreation/recovery path where previously delivered keyups are no longer guaranteed to arrive.

This protects against Android lifecycle transitions independently of the Add Translation flow.

---

## Important ordering consideration

The reset should happen **before accepting later hardware events for a new ownership epoch**.

It should not be implemented as an arbitrary delayed cleanup that could race with the next chord.

If Java sends a reset into the WebView asynchronously, use the existing input-view generation / ownership checks so a stale WebView cannot reset the current one.

The existing `GenerationOwnership` mechanism should continue to protect JavaScript bridges from stale input views.

---

## Suggested stronger design

The current implementation has several independently maintained pieces of key state:

```text
Android
  HardwareKeyActionResolver
  webCapturedHardwareKeys
  editorPassedHardwareKeys

WebUI
  KeyboardStrokeTracker.heldKeys
  KeyboardStrokeTracker.strokeKeys
  pressedQwertyKeys
```

The immediate fix can keep this architecture, but all invalidation paths should funnel through a single conceptual operation:

```text
invalidateCurrentHardwareChord()
```

That operation should clear every state component that can refer to the current physical chord.

This reduces the chance that future focus/lifecycle work fixes one state container but leaves another stale.

---

## Regression tests

### Unit test: `KeyboardStrokeTracker.reset()`

Add a focused unit test covering:

```text
keydown Q
reset
keydown A
keyup A
```

The second chord must emit normally and must not contain Q.

Also test:

```text
keydown Q
keydown W
reset
keyup Q
keyup W
```

No stale stroke should be emitted after reset.

---

### WebUI regression test: blur between keydown and keyup

Simulate:

1. `keydown("q")`
2. `window.blur` / call the canonical hardware reset
3. do not deliver the old `keyup("q")`
4. perform a fresh complete chord

Assert:

- fresh chord is emitted;
- no stale Q/# is present;
- pressed-key UI is clear.

This should directly catch the root failure.

---

### Android integration test: native focus steals the keyup

Create an integration scenario that mirrors the actual bug:

1. IME WebView receives a hardware `keydown`;
2. native `PloverCommandActivity` control becomes focused;
3. `PloverCommandFocusState.shouldPassHardwareKeyToActivity()` becomes true;
4. Android clears `webCapturedHardwareKeys`;
5. matching `keyup` is not delivered to the WebView;
6. close the command activity;
7. send a fresh valid chord.

Assert that the new chord reaches `handleChord()` and produces the expected output/RPC.

---

### Add Translation end-to-end regression

Exercise the real user workflow:

1. open Add Translation;
2. load dictionary choices;
3. choose a dictionary;
4. add a new translation successfully;
5. close Add Translation;
6. return to the editor;
7. type several consecutive chords.

Assert:

- all chords are processed;
- the keyboard display changes for each keydown/keyup;
- Stripped Plover translation continues to work;
- no IME restart is required.

Run the cycle multiple times in one test:

```text
add translation -> close -> type
add translation -> close -> type
add translation -> close -> type
```

This helps expose lifecycle leaks and stale ownership state.

---

### Input-view recreation regression

Simulate or instrument:

```text
create input view A
deliver keydown
recreate input view
create input view B
type a complete chord
```

Only view B must affect current IME state.

This complements the existing generation ownership checks.

---

## Instrumentation recommended during debugging

Add temporary debug logging around state ownership transitions.

### Android

Log:

- `serviceGeneration`
- input-view generation
- `webCapturedHardwareKeys`
- `editorPassedHardwareKeys`
- `PloverCommandFocusState.isNativeControlFocused()`
- each forwarded `keydown` / `keyup`
- each path that clears captured-key state

Example:

```text
V7Ime HW keydown code=Q forwarded=true viewGeneration=12 captured=[Q]
V7Ime native focus takeover viewGeneration=12 clearing captured=[Q]
V7Ime HW keyup code=Q passedToActivity=true
```

### WebUI

In debug builds, log:

- keyDown/keyUp mapped key;
- `heldKeys`;
- `strokeKeys`;
- hardware-state reset reason.

Example:

```text
KeyboardStrokeTracker keyDown "#" held=["#"] stroke=["#"]
KeyboardStrokeTracker reset reason="android-native-focus"
KeyboardStrokeTracker keyDown "T-" held=["T-"] stroke=["T-"]
KeyboardStrokeTracker keyUp "T-" emit="T"
```

This would make the bug immediately visible in `adb logcat` + WebView console output.

---

## Acceptance criteria

The bug is fixed when all of the following are true:

- [ ] `KeyboardStrokeTracker` has an explicit way to invalidate an in-progress chord.
- [ ] Focus loss clears both the visual pressed-key state and logical held/stroke state.
- [ ] Android native-control focus takeover cannot strand a key in the WebUI.
- [ ] `onStartInput()` and `onFinishInput()` cannot carry an incomplete chord into a new input session.
- [ ] IME input-view recreation cannot preserve stale chord state.
- [ ] Add Translation can be opened, used, closed, and followed immediately by normal V7/Stripped Plover typing.
- [ ] Repeating the Add Translation workflow several times does not degrade keyboard behavior.
- [ ] A missing keyup from an old ownership epoch cannot block future strokes.
- [ ] A regression test explicitly covers `keydown -> ownership/focus transition -> lost keyup -> fresh chord`.
- [ ] Existing Android key routing, native dialog keyboard navigation, Ctrl+Shift mode toggle, and raw-outline behavior remain functional.

---

## Non-goals

This bug does not require redesigning Stripped Plover dictionary mutation APIs.

PR #144's safe dictionary mutation work (`add_entry_safely`, `replace_entry`, exact lookup, structured protocol errors) is orthogonal to this issue.

The bug is also not, based on current evidence, a request to replace the singleton `BundledStrippedPloverRuntime` architecture.

---

## Risk areas while fixing

Pay particular attention to:

- `Ctrl+Shift` persistent V7 mode toggle;
- native `PloverCommandActivity` navigation keys;
- `Escape` handling;
- raw-outline input mode;
- Android input-view recreation;
- hardware key repeat;
- switching IMEs;
- app/editor focus changes;
- WebView blur and visibility events;
- stale JavaScript calls from destroyed WebViews.

A hardware-state reset should cancel only the **in-progress physical chord**. It should not erase already committed editor text or dictionary state.

---

## Severity

Suggested severity: **High / P1-P2 depending on reproducibility**

Reason:

- once triggered, primary hardware-steno input can stop functioning;
- the failure appears persistent until the IME/input view is reset;
- it affects a core workflow immediately after dictionary editing;
- the UI gives little indication that an internal key remains stuck;
- users may reasonably interpret it as data/runtime corruption or multiple stale keyboard instances.

---

## Proposed issue title

**Fix stale Android hardware-key chord state after Add Translation / native focus transitions**

Alternative:

**Android IME can stop emitting chords after Add Translation because lost keyup leaves WebUI key state stuck**
