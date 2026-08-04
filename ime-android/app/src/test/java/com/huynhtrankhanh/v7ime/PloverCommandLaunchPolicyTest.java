package com.huynhtrankhanh.v7ime;

import android.content.Intent;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class PloverCommandLaunchPolicyTest {
    @Test
    public void commandDialogsUseAnIndependentEphemeralTask() {
        int expected = Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_MULTIPLE_TASK
                | Intent.FLAG_ACTIVITY_NO_HISTORY
                | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS;

        assertEquals(expected, PloverCommandLaunchPolicy.FLAGS);
    }
}
