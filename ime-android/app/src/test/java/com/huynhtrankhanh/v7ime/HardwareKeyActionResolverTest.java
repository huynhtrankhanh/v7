package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;

import org.junit.Test;

public class HardwareKeyActionResolverTest {
    @Test
    public void controlThenShiftTogglesOnceAndBalancesControl() {
        HardwareKeyActionResolver resolver = new HardwareKeyActionResolver();
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_CTRL_LEFT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_SHIFT_RIGHT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertTrue(resolver.isModeToggleChordActive());
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_SHIFT_RIGHT,
                        KeyEvent.ACTION_DOWN,
                        1
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_SHIFT_RIGHT,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
        assertTrue(resolver.isModeToggleChordActive());
        assertEquals(
                HardwareKeyActionResolver.Action.TOGGLE_STENO,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_CTRL_LEFT,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
        assertFalse(resolver.isModeToggleChordActive());
    }

    @Test
    public void shiftThenControlTogglesAndBalancesShift() {
        HardwareKeyActionResolver resolver = new HardwareKeyActionResolver();
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        false,
                        KeyEvent.KEYCODE_SHIFT_LEFT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        false,
                        KeyEvent.KEYCODE_CTRL_RIGHT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        false,
                        KeyEvent.KEYCODE_CTRL_RIGHT,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.TOGGLE_STENO,
                resolver.resolve(
                        false,
                        KeyEvent.KEYCODE_SHIFT_LEFT,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
    }

    @Test
    public void modifiedArrowCancelsPendingToggleAndPassesThrough() {
        HardwareKeyActionResolver resolver = new HardwareKeyActionResolver();
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_CTRL_LEFT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_SHIFT_LEFT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertTrue(resolver.isModeToggleChordActive());
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_DPAD_LEFT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertFalse(resolver.isModeToggleChordActive());
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_SHIFT_LEFT,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_CTRL_LEFT,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
    }

    @Test
    public void soloModifiersAndMetaPassThrough() {
        HardwareKeyActionResolver resolver = new HardwareKeyActionResolver();
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_SHIFT_LEFT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_SHIFT_LEFT,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_META_LEFT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
    }

    @Test
    public void leftBracketFinishesPreeditOnlyInStenoMode() {
        HardwareKeyActionResolver resolver = new HardwareKeyActionResolver();
        assertEquals(
                HardwareKeyActionResolver.Action.FINISH_PREEDIT,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_LEFT_BRACKET,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.CONSUME,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_LEFT_BRACKET,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                resolver.resolve(
                        false,
                        KeyEvent.KEYCODE_LEFT_BRACKET,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
    }

    @Test
    public void repeatedLeftBracketDoesNotFinishTwice() {
        HardwareKeyActionResolver resolver = new HardwareKeyActionResolver();
        assertEquals(
                HardwareKeyActionResolver.Action.CONSUME,
                resolver.resolve(
                        true,
                        KeyEvent.KEYCODE_LEFT_BRACKET,
                        KeyEvent.ACTION_DOWN,
                        2
                )
        );
    }
}
