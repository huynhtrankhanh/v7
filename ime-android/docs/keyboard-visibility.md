# Virtual-keyboard visibility with an external keyboard

V7 deliberately keeps its input view available while a physical keyboard is
connected. The physical keyboard supplies steno chords; the V7 input view still
shows the active composition and its alternatives.

## Why attach and detach need explicit handling

Connecting or disconnecting a physical keyboard changes Android's
`Configuration.keyboard`, `keyboardHidden`, and/or `hardKeyboardHidden` values.
`InputMethodService` rebuilds its input view during that configuration change.
Android's default show policy can then decline an implicit show request because
a hardware keyboard is present, even though V7 still needs its composition
view.

V7 uses the following policy:

1. `onEvaluateInputViewShown()` always makes the input view eligible. This is
   V7's intentional hardware-keyboard companion behavior.
2. `onShowInputRequested()` retains Android's normal answer, but also permits a
   request while V7 has an active editor. Merely having the IME service alive is
   not sufficient.
3. `onConfigurationChanged()` first lets `InputMethodService` rebuild its
   window. If a keyboard-related field changed and input is still active, V7
   posts one show request after that rebuild.
4. Every posted recovery carries the current input generation. Finishing input
   or starting another editor invalidates an older request, so a delayed
   callback cannot show V7 over the wrong app or field.

Pressing Back to hide the input view does not itself change the keyboard
configuration and therefore does not trigger recovery.

Android 9 and later use `requestShowSelf(SHOW_IMPLICIT)`. The Android 6–8
fallback uses `showWindow(true)`. Both paths run only after the guarded
keyboard-configuration transition.

## View recreation

The platform can request a new input view as part of the configuration reset.
Before creating the replacement, V7 destroys the previous `WebView`; this
prevents a detached WebView and its JavaScript context from leaking across
repeated keyboard attach/detach cycles. Native composition state remains owned
by the service and follows the normal Android input-session callbacks.

## Verification

Host-side tests cover:

- hardware keyboard attach and detach;
- a `hardKeyboardHidden` transition;
- unrelated configuration changes;
- changes while no editor is active;
- input finishing before a posted recovery runs; and
- moving to another editor before the recovery runs.

The Android WebUI bridge test also runs after the native unit suite to verify
that input-view recreation changes do not alter the JavaScript bridge contract.
Physical-device verification should exercise both connection directions while
an editable field is focused, plus a Back-button hide with no connection
change.

## Platform references

- [InputMethodService](https://developer.android.com/reference/android/inputmethodservice/InputMethodService)
  documents input-view evaluation, configuration handling, and show requests.
- [Support connected displays: physical keyboards](https://developer.android.com/develop/adaptive-apps/cookbook/detachable-keyboard)
  describes the configuration changes produced by attaching and detaching a
  keyboard.
- [Configuration](https://developer.android.com/reference/android/content/res/Configuration)
  defines the keyboard and keyboard-visibility fields tracked here.
