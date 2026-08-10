package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

/**
 * Tells the IME when a native command control, rather than an editor, owns
 * focus. Android can otherwise keep the last EditText's InputConnection alive
 * and route radio-button shortcuts back through steno capture.
 */
final class PloverCommandFocusState {
    private static volatile boolean nativeControlFocused;

    private PloverCommandFocusState() {
    }

    static void setNativeControlFocused(boolean focused) {
        nativeControlFocused = focused;
    }

    static boolean shouldPassHardwareKeyToActivity(int keyCode) {
        // Escape belongs to the command window even while one of its editors
        // has an InputConnection. Otherwise raw-outline capture can consume it
        // before Activity.dispatchKeyEvent has a chance to close the window.
        if (keyCode == KeyEvent.KEYCODE_ESCAPE) {
            return true;
        }
        if (!nativeControlFocused) {
            return false;
        }
        // Ctrl+Shift is V7's persistent mode toggle. Native dialog controls
        // own navigation keys, but must not swallow or emulate that IME chord.
        return keyCode != KeyEvent.KEYCODE_CTRL_LEFT
                && keyCode != KeyEvent.KEYCODE_CTRL_RIGHT
                && keyCode != KeyEvent.KEYCODE_SHIFT_LEFT
                && keyCode != KeyEvent.KEYCODE_SHIFT_RIGHT;
    }

    static boolean isNativeControlFocused() {
        return nativeControlFocused;
    }
}
