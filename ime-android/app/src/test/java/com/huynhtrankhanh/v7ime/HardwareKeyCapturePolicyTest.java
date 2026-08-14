package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;

import org.junit.Test;

public class HardwareKeyCapturePolicyTest {
    private final HardwareKeyCapturePolicy policy = new HardwareKeyCapturePolicy();

    @Test
    public void v7RetainsItsOriginalCaptureVocabulary() {
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_A, 'a', false));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_SEMICOLON, ';', false));
        assertFalse(policy.isCaptured(KeyEvent.KEYCODE_DEL, 0, false));
        assertFalse(policy.isCaptured(KeyEvent.KEYCODE_TAB, 0, false));
        assertFalse(policy.isCaptured(KeyEvent.KEYCODE_COMMA, ',', false));
        assertFalse(policy.isCaptured(KeyEvent.KEYCODE_LEFT_BRACKET, '[', false));
    }

    @Test
    public void telexAddsEditingAndSeparatorKeys() {
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_DEL, 0, true));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_TAB, 0, true));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_COMMA, ',', true));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_LEFT_BRACKET, '[', true));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_NUMPAD_7, '7', true));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_NUMPAD_ADD, '+', true));
        assertTrue(policy.isCaptured(KeyEvent.KEYCODE_UNKNOWN, 0x00a7, true));
        assertFalse(policy.isCaptured(KeyEvent.KEYCODE_F1, 0, true));
    }
}
