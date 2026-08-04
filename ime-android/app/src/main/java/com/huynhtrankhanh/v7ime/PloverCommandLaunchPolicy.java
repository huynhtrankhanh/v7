package com.huynhtrankhanh.v7ime;

import android.content.Intent;

/** Keeps transient command dialogs independent from the launchable settings task. */
final class PloverCommandLaunchPolicy {
    static final int FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_MULTIPLE_TASK
            | Intent.FLAG_ACTIVITY_NO_HISTORY
            | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS;

    private PloverCommandLaunchPolicy() {
    }
}
