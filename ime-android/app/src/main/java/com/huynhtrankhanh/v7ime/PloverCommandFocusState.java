package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

/**
 * Tells the IME when a native command control, rather than an editor, owns
 * focus. Android can otherwise keep the last EditText's InputConnection alive
 * and route radio-button shortcuts back through steno capture.
 */
final class PloverCommandFocusState {
    private static volatile boolean nativeControlFocused;
    private static volatile boolean commandActivityActive;

    private PloverCommandFocusState() {
    }

    static void setNativeControlFocused(boolean focused) {
        nativeControlFocused = focused;
    }

    static void setCommandActivityActive(boolean active) {
        commandActivityActive = active;
    }

    static boolean shouldPassHardwareKeyToActivity(int keyCode) {
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

    static boolean shouldPassHardwareKeyToActivity(KeyEvent event) {
        // Unmodified Escape belongs to the command window even while one of
        // its editors has an InputConnection. Outside that window Escape must
        // retain its ordinary WebUI/raw-mode behavior.
        if (event.getKeyCode() == KeyEvent.KEYCODE_ESCAPE) {
            return commandActivityActive
                    && !event.isShiftPressed()
                    && !event.isCtrlPressed()
                    && !event.isAltPressed()
                    && !event.isMetaPressed();
        }
        return shouldPassHardwareKeyToActivity(event.getKeyCode());
    }

    static boolean isNativeControlFocused() {
        return nativeControlFocused;
    }
}
