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

    @Test
    public void altGraphPrintableInputIsDistinctFromEditorShortcuts() {
        assertTrue(policy.capturesModifiedPrintable(true, '€', true, false));
        assertFalse(policy.capturesModifiedPrintable(true, 'c', false, false));
        assertFalse(policy.capturesModifiedPrintable(true, 'x', true, true));
        assertFalse(policy.capturesModifiedPrintable(false, '€', true, false));
    }

    @Test
    public void clipboardDigitsAreCapturedOnlyInV7WithOneModifier() {
        for (int digit = 0; digit <= 9; digit++) {
            for (int base : new int[]{KeyEvent.KEYCODE_0, KeyEvent.KEYCODE_NUMPAD_0}) {
                for (int modifier : new int[]{KeyEvent.META_CTRL_ON, KeyEvent.META_ALT_ON}) {
                    KeyEvent event = new KeyEvent(0, 0, KeyEvent.ACTION_DOWN,
                            base + digit, 0, modifier);
                    assertTrue(policy.capturesClipboardSlot(event, true));
                    assertFalse(policy.capturesClipboardSlot(event, false));
                    assertTrue(policy.isCaptured(base + digit, 0, false));
                }
            }
        }
        for (int modifier : new int[]{0, KeyEvent.META_CTRL_ON | KeyEvent.META_ALT_ON,
                KeyEvent.META_CTRL_ON | KeyEvent.META_SHIFT_ON, KeyEvent.META_META_ON}) {
            assertFalse(policy.capturesClipboardSlot(new KeyEvent(0, 0,
                    KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_1, 0, modifier), true));
        }
        assertFalse(policy.capturesClipboardSlot(new KeyEvent(0, 0,
                KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_C, 0, KeyEvent.META_CTRL_ON), true));
    }
}
