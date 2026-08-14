package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

final class HardwareKeyCapturePolicy {
    boolean isCaptured(int keyCode, boolean telexModeEnabled) {
        if ((keyCode >= KeyEvent.KEYCODE_A && keyCode <= KeyEvent.KEYCODE_Z)
                || (keyCode >= KeyEvent.KEYCODE_0 && keyCode <= KeyEvent.KEYCODE_9)
                || keyCode == KeyEvent.KEYCODE_SEMICOLON
                || keyCode == KeyEvent.KEYCODE_SPACE
                || keyCode == KeyEvent.KEYCODE_SHIFT_LEFT
                || keyCode == KeyEvent.KEYCODE_SHIFT_RIGHT
                || keyCode == KeyEvent.KEYCODE_CTRL_LEFT
                || keyCode == KeyEvent.KEYCODE_CTRL_RIGHT
                || keyCode == KeyEvent.KEYCODE_ALT_LEFT
                || keyCode == KeyEvent.KEYCODE_ALT_RIGHT
                || keyCode == KeyEvent.KEYCODE_META_LEFT
                || keyCode == KeyEvent.KEYCODE_META_RIGHT
                || keyCode == KeyEvent.KEYCODE_CAPS_LOCK
                || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            return true;
        }
        return telexModeEnabled && isTelexOnlyKey(keyCode);
    }

    private boolean isTelexOnlyKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_TAB
                || keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
                || keyCode == KeyEvent.KEYCODE_DEL
                || keyCode == KeyEvent.KEYCODE_COMMA
                || keyCode == KeyEvent.KEYCODE_PERIOD
                || keyCode == KeyEvent.KEYCODE_SLASH
                || keyCode == KeyEvent.KEYCODE_APOSTROPHE
                || keyCode == KeyEvent.KEYCODE_LEFT_BRACKET
                || keyCode == KeyEvent.KEYCODE_RIGHT_BRACKET
                || keyCode == KeyEvent.KEYCODE_MINUS
                || keyCode == KeyEvent.KEYCODE_EQUALS
                || keyCode == KeyEvent.KEYCODE_GRAVE
                || keyCode == KeyEvent.KEYCODE_BACKSLASH
                || keyCode == KeyEvent.KEYCODE_AT
                || keyCode == KeyEvent.KEYCODE_PLUS;
    }
}
