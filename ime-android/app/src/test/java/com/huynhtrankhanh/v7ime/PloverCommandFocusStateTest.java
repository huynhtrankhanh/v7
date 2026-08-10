package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

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
        assertTrue(PloverCommandFocusState.isNativeControlFocused());
        assertTrue(PloverCommandFocusState.shouldPassHardwareKeyToActivity(
                KeyEvent.KEYCODE_TAB
        ));
        assertTrue(PloverCommandFocusState.shouldPassHardwareKeyToActivity(
                KeyEvent.KEYCODE_1
        ));
        assertFalse(PloverCommandFocusState.shouldPassHardwareKeyToActivity(
                KeyEvent.KEYCODE_CTRL_LEFT
        ));
        assertFalse(PloverCommandFocusState.shouldPassHardwareKeyToActivity(
                KeyEvent.KEYCODE_SHIFT_RIGHT
        ));

        PloverCommandFocusState.setNativeControlFocused(false);
        assertFalse(PloverCommandFocusState.isNativeControlFocused());
        assertFalse(PloverCommandFocusState.shouldPassHardwareKeyToActivity(
                KeyEvent.KEYCODE_TAB
        ));
    }

    @Test
    public void routesEscapeToActivityEvenWhileEditorOwnsFocus() {
        PloverCommandFocusState.setNativeControlFocused(false);
        assertTrue(PloverCommandFocusState.shouldPassHardwareKeyToActivity(
                KeyEvent.KEYCODE_ESCAPE
        ));
    }
}
