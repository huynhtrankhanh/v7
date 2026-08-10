package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;
import android.view.inputmethod.EditorInfo;

final class NativeFormSubmit {
    private NativeFormSubmit() {
    }

    static boolean shouldSubmit(
            int actionId,
            int keyCode,
            int keyAction) {
        if (actionId == EditorInfo.IME_ACTION_DONE
                || actionId == EditorInfo.IME_ACTION_GO
                || actionId == EditorInfo.IME_ACTION_SEND) {
            return true;
        }
        return (keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER)
                && keyAction == KeyEvent.ACTION_DOWN;
    }
}
