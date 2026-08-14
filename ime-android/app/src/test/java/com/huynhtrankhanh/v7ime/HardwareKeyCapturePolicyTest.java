package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;

import org.junit.Test;

public class HardwareKeyCapturePolicyTest {
    private final HardwareKeyCapturePolicy policy = new HardwareKeyCapturePolicy();

    @Test
    public void v7RetainsItsOriginalCaptureVocabulary() {
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_A, false));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_SEMICOLON, false));
        assertFalse(policy.isCaptured(KeyEvent.KEYCODE_DEL, false));
        assertFalse(policy.isCaptured(KeyEvent.KEYCODE_TAB, false));
        assertFalse(policy.isCaptured(KeyEvent.KEYCODE_COMMA, false));
        assertFalse(policy.isCaptured(KeyEvent.KEYCODE_LEFT_BRACKET, false));
    }

    @Test
    public void telexAddsEditingAndSeparatorKeys() {
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_DEL, true));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_TAB, true));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_COMMA, true));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_LEFT_BRACKET, true));
    }
}
