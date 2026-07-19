package com.huynhtrankhanh.v7ime;

import android.view.inputmethod.EditorInfo;

final class EditorActionResolver {
    private EditorActionResolver() {
    }

    static int resolve(int imeOptions, int customActionId) {
        if (customActionId != 0) {
            return customActionId;
        }
        int action = imeOptions & EditorInfo.IME_MASK_ACTION;
        if (action == EditorInfo.IME_ACTION_NONE
                || action == EditorInfo.IME_ACTION_UNSPECIFIED) {
            return 0;
        }
        return action;
    }
}
