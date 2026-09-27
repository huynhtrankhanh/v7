package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

/** Host editors must receive balanced modifiers and their own selection keys. */
final class HardwareEditorKeyPolicy {
    static boolean isModifier(int code) {
        return code == KeyEvent.KEYCODE_SHIFT_LEFT || code == KeyEvent.KEYCODE_SHIFT_RIGHT
                || code == KeyEvent.KEYCODE_CTRL_LEFT || code == KeyEvent.KEYCODE_CTRL_RIGHT
                || code == KeyEvent.KEYCODE_ALT_LEFT || code == KeyEvent.KEYCODE_ALT_RIGHT
                || code == KeyEvent.KEYCODE_META_LEFT || code == KeyEvent.KEYCODE_META_RIGHT;
    }
    static boolean isSelectionNavigation(KeyEvent event) {
        if (!event.isShiftPressed()) return false;
        int code = event.getKeyCode();
        return code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT
                || code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN;
    }
}
