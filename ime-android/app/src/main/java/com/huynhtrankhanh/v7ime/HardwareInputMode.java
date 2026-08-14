package com.huynhtrankhanh.v7ime;

enum HardwareInputMode {
    V7_PLOVER,
    TELEX,
    NORMAL;

    static final class Transition {
        final HardwareInputMode mode;
        final boolean finishPreedit;

        Transition(HardwareInputMode mode) {
            this.mode = mode;
            this.finishPreedit = true;
        }
    }

    Transition onControlTab() {
        return new Transition(this == TELEX ? V7_PLOVER : TELEX);
    }

    Transition onControlShift() {
        return new Transition(this == NORMAL ? V7_PLOVER : NORMAL);
    }

    boolean usesNativeTelex(boolean rawOutlineMode) {
        return this == TELEX && !rawOutlineMode;
    }
}
