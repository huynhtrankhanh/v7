package com.huynhtrankhanh.v7ime;

import org.junit.After;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PloverCommandFocusStateTest {
    @After
    public void reset() {
        PloverCommandFocusState.setNativeControlFocused(false);
    }

    @Test
    public void routesHardwareKeysToNativeFocusedControls() {
        PloverCommandFocusState.setNativeControlFocused(true);
        assertTrue(PloverCommandFocusState.shouldPassHardwareKeysToActivity());

        PloverCommandFocusState.setNativeControlFocused(false);
        assertFalse(PloverCommandFocusState.shouldPassHardwareKeysToActivity());
    }
}
