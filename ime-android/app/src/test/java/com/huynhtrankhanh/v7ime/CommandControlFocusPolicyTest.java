package com.huynhtrankhanh.v7ime;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class CommandControlFocusPolicyTest {
    @Test
    public void editorsCanTakeTouchFocusButCommandControlsActivateDirectly() {
        assertTrue(CommandControlFocusPolicy.focusableInTouchMode(true));
        assertFalse(CommandControlFocusPolicy.focusableInTouchMode(false));
    }
}
