package com.huynhtrankhanh.v7ime;

import android.content.Intent;

/** Reuses one transient command task without bringing settings to the foreground. */
final class PloverCommandLaunchPolicy {
    static final int FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NO_HISTORY
            | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS;

    private PloverCommandLaunchPolicy() {
    }
}
