package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
public class HardwareEditorKeyPolicyTest {
    @Test public void allSelectionDirectionsAndModifiersAreRoutedToHost() {
        for (int direction : new int[]{KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN}) {
            for (int modifiers : new int[]{KeyEvent.META_SHIFT_ON,
                    KeyEvent.META_SHIFT_ON | KeyEvent.META_CTRL_ON}) {
                assertTrue(HardwareEditorKeyPolicy.isSelectionNavigation(
                        new KeyEvent(0, 0, KeyEvent.ACTION_DOWN, direction, 0, modifiers)));
                assertTrue(HardwareEditorKeyPolicy.isSelectionNavigation(
                        new KeyEvent(0, 1, KeyEvent.ACTION_UP, direction, 0, modifiers)));
            }
            assertFalse(HardwareEditorKeyPolicy.isSelectionNavigation(
                    new KeyEvent(0, 0, KeyEvent.ACTION_DOWN, direction, 0, 0)));
        }
        for (int modifier : new int[]{KeyEvent.KEYCODE_SHIFT_LEFT, KeyEvent.KEYCODE_SHIFT_RIGHT,
                KeyEvent.KEYCODE_CTRL_LEFT, KeyEvent.KEYCODE_CTRL_RIGHT,
                KeyEvent.KEYCODE_ALT_LEFT, KeyEvent.KEYCODE_ALT_RIGHT,
                KeyEvent.KEYCODE_META_LEFT, KeyEvent.KEYCODE_META_RIGHT})
            assertTrue(HardwareEditorKeyPolicy.isModifier(modifier));
    }
    @Test public void controlShiftSelectionDoesNotToggleMode() {
        for (int direction : new int[]{KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN}) {
            HardwareKeyActionResolver resolver = new HardwareKeyActionResolver();
            resolver.resolve(true, KeyEvent.KEYCODE_CTRL_LEFT, KeyEvent.ACTION_DOWN, 0);
            resolver.resolve(true, KeyEvent.KEYCODE_SHIFT_LEFT, KeyEvent.ACTION_DOWN, 0);
            assertEquals(HardwareKeyActionResolver.Action.PASS_THROUGH,
                    resolver.resolve(true, direction, KeyEvent.ACTION_DOWN, 0));
            resolver.resolve(true, direction, KeyEvent.ACTION_UP, 0);
            assertEquals(HardwareKeyActionResolver.Action.PASS_THROUGH,
                    resolver.resolve(true, KeyEvent.KEYCODE_SHIFT_LEFT, KeyEvent.ACTION_UP, 0));
            assertEquals(HardwareKeyActionResolver.Action.PASS_THROUGH,
                    resolver.resolve(true, KeyEvent.KEYCODE_CTRL_LEFT, KeyEvent.ACTION_UP, 0));
        }
    }
}
