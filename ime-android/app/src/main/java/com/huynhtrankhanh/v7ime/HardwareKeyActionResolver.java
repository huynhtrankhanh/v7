package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

import java.util.HashSet;
import java.util.Set;

final class HardwareKeyActionResolver {
    enum Action {
        PASS_THROUGH,
        CONSUME,
        TOGGLE_STENO,
        FINISH_PREEDIT,
        FINISH_PREEDIT_AND_INSERT_SPACE
    }

    private final Set<Integer> pressedControlKeys = new HashSet<>();
    private final Set<Integer> pressedShiftKeys = new HashSet<>();
    private boolean toggleChordPending = false;

    Action resolve(
            boolean stenoModeEnabled,
            int keyCode,
            int action,
            int repeatCount) {
        if (isControlKey(keyCode) || isShiftKey(keyCode)) {
            return resolveModeToggleChord(keyCode, action);
        }

        if (toggleChordPending && action == KeyEvent.ACTION_DOWN) {
            toggleChordPending = false;
        }

        if (stenoModeEnabled && keyCode == KeyEvent.KEYCODE_LEFT_BRACKET) {
            if (action == KeyEvent.ACTION_DOWN && repeatCount == 0) {
                return Action.FINISH_PREEDIT;
            }
            return Action.CONSUME;
        }

        if (stenoModeEnabled && keyCode == KeyEvent.KEYCODE_APOSTROPHE) {
            if (action == KeyEvent.ACTION_DOWN && repeatCount == 0) {
                return Action.FINISH_PREEDIT_AND_INSERT_SPACE;
            }
            return Action.CONSUME;
        }

        return Action.PASS_THROUGH;
    }

    void reset() {
        pressedControlKeys.clear();
        pressedShiftKeys.clear();
        toggleChordPending = false;
    }

    boolean isModeToggleChordActive() {
        return toggleChordPending;
    }

    private Action resolveModeToggleChord(
            int keyCode,
            int action) {
        Set<Integer> pressedKeys = isControlKey(keyCode)
                ? pressedControlKeys
                : pressedShiftKeys;

        if (action == KeyEvent.ACTION_DOWN) {
            pressedKeys.add(keyCode);
            if (!pressedControlKeys.isEmpty()
                    && !pressedShiftKeys.isEmpty()) {
                toggleChordPending = true;
            }
            return Action.PASS_THROUGH;
        }

        if (action == KeyEvent.ACTION_UP) {
            pressedKeys.remove(keyCode);
            if (toggleChordPending
                    && pressedControlKeys.isEmpty()
                    && pressedShiftKeys.isEmpty()) {
                toggleChordPending = false;
                return Action.TOGGLE_STENO;
            }
        }

        return Action.PASS_THROUGH;
    }

    private boolean isControlKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_CTRL_LEFT
                || keyCode == KeyEvent.KEYCODE_CTRL_RIGHT;
    }

    private boolean isShiftKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_SHIFT_LEFT
                || keyCode == KeyEvent.KEYCODE_SHIFT_RIGHT;
    }
}
