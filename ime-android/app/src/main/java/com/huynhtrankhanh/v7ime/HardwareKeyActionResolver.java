package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

import java.util.HashSet;
import java.util.Set;

final class HardwareKeyActionResolver {
    enum Action {
        PASS_THROUGH,
        CONSUME,
        TOGGLE_STENO,
        FINISH_PREEDIT
    }

    private final Set<Integer> pressedControlKeys = new HashSet<>();
    private final Set<Integer> pressedShiftKeys = new HashSet<>();
    private final Set<Integer> passedThroughChordKeys = new HashSet<>();
    private boolean toggleChordActive = false;

    Action resolve(
            boolean stenoModeEnabled,
            int keyCode,
            int action,
            int repeatCount) {
        if (isControlKey(keyCode) || isShiftKey(keyCode)) {
            return resolveModeToggleChord(keyCode, action, repeatCount);
        }

        if (stenoModeEnabled && keyCode == KeyEvent.KEYCODE_LEFT_BRACKET) {
            if (action == KeyEvent.ACTION_DOWN && repeatCount == 0) {
                return Action.FINISH_PREEDIT;
            }
            return Action.CONSUME;
        }

        return Action.PASS_THROUGH;
    }

    void reset() {
        pressedControlKeys.clear();
        pressedShiftKeys.clear();
        passedThroughChordKeys.clear();
        toggleChordActive = false;
    }

    boolean isModeToggleChordActive() {
        return toggleChordActive;
    }

    private Action resolveModeToggleChord(
            int keyCode,
            int action,
            int repeatCount) {
        Set<Integer> pressedKeys = isControlKey(keyCode)
                ? pressedControlKeys
                : pressedShiftKeys;

        if (action == KeyEvent.ACTION_DOWN) {
            pressedKeys.add(keyCode);
            if (!toggleChordActive
                    && repeatCount == 0
                    && !pressedControlKeys.isEmpty()
                    && !pressedShiftKeys.isEmpty()) {
                toggleChordActive = true;
                return Action.TOGGLE_STENO;
            }
            if (toggleChordActive) {
                return Action.CONSUME;
            }
            passedThroughChordKeys.add(keyCode);
            return Action.PASS_THROUGH;
        }

        if (action == KeyEvent.ACTION_UP) {
            pressedKeys.remove(keyCode);
            boolean balancePassedDown =
                    passedThroughChordKeys.remove(keyCode);
            if (pressedControlKeys.isEmpty() && pressedShiftKeys.isEmpty()) {
                toggleChordActive = false;
                passedThroughChordKeys.clear();
            }
            return balancePassedDown
                    ? Action.PASS_THROUGH
                    : Action.CONSUME;
        }

        return toggleChordActive
                ? Action.CONSUME
                : Action.PASS_THROUGH;
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
