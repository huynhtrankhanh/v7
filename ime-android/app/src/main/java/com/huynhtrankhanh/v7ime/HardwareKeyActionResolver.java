package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

final class HardwareKeyActionResolver {
    enum Action {
        PASS_THROUGH,
        CONSUME,
        TOGGLE_STENO,
        FINISH_PREEDIT
    }

    private HardwareKeyActionResolver() {}

    static Action resolve(
            boolean stenoModeEnabled,
            int keyCode,
            int action,
            int repeatCount) {
        if (keyCode == KeyEvent.KEYCODE_META_LEFT
                || keyCode == KeyEvent.KEYCODE_META_RIGHT) {
            if (action == KeyEvent.ACTION_DOWN && repeatCount == 0) {
                return Action.TOGGLE_STENO;
            }
            return Action.CONSUME;
        }

        if (stenoModeEnabled && keyCode == KeyEvent.KEYCODE_LEFT_BRACKET) {
            if (action == KeyEvent.ACTION_DOWN && repeatCount == 0) {
                return Action.FINISH_PREEDIT;
            }
            return Action.CONSUME;
        }

        return Action.PASS_THROUGH;
    }
}
