package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

final class TelexHardwareKeyPolicy {
    enum Route {
        WEB_PREEDIT,
        EDITOR,
        EDITOR_ENTER
    }

    Route resolve(
            int keyCode, boolean hasPreedit, boolean hasPendingDeadAccent) {
        if (keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            return Route.EDITOR_ENTER;
        }
        if (keyCode == KeyEvent.KEYCODE_DEL
                && !hasPreedit
                && !hasPendingDeadAccent) {
            return Route.EDITOR;
        }
        if (keyCode == KeyEvent.KEYCODE_ESCAPE) return Route.EDITOR;
        return Route.WEB_PREEDIT;
    }

    boolean dispatchKeyUpToEditor(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER;
    }
}
