package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

final class DictionarySelectionShortcut {
    private DictionarySelectionShortcut() {
    }

    static int indexFor(int keyCode, int itemCount) {
        return indexFor(keyCode, itemCount, true);
    }

    static int indexFor(int keyCode, int itemCount, boolean enabled) {
        if (!enabled) {
            return -1;
        }
        int number;
        if (keyCode >= KeyEvent.KEYCODE_1 && keyCode <= KeyEvent.KEYCODE_9) {
            number = keyCode - KeyEvent.KEYCODE_1 + 1;
        } else if (keyCode >= KeyEvent.KEYCODE_NUMPAD_1
                && keyCode <= KeyEvent.KEYCODE_NUMPAD_9) {
            number = keyCode - KeyEvent.KEYCODE_NUMPAD_1 + 1;
        } else {
            return -1;
        }
        int index = number - 1;
        return index < itemCount ? index : -1;
    }
}
