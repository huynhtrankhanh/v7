package com.huynhtrankhanh.v7ime;

final class CommandControlFocusPolicy {
    private CommandControlFocusPolicy() {}

    static boolean focusableInTouchMode(boolean editor) {
        return editor;
    }
}
