package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;

import android.view.KeyEvent;

import org.junit.Test;

public class HardwareKeyActionResolverTest {
    @Test
    public void metaDownTogglesStenoAndAllOtherMetaEventsAreConsumed() {
        assertEquals(
                HardwareKeyActionResolver.Action.TOGGLE_STENO,
                HardwareKeyActionResolver.resolve(
                        true,
                        KeyEvent.KEYCODE_META_LEFT,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.CONSUME,
                HardwareKeyActionResolver.resolve(
                        false,
                        KeyEvent.KEYCODE_META_RIGHT,
                        KeyEvent.ACTION_DOWN,
                        1
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.CONSUME,
                HardwareKeyActionResolver.resolve(
                        false,
                        KeyEvent.KEYCODE_META_LEFT,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
    }

    @Test
    public void leftBracketFinishesPreeditOnlyInStenoMode() {
        assertEquals(
                HardwareKeyActionResolver.Action.FINISH_PREEDIT,
                HardwareKeyActionResolver.resolve(
                        true,
                        KeyEvent.KEYCODE_LEFT_BRACKET,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.CONSUME,
                HardwareKeyActionResolver.resolve(
                        true,
                        KeyEvent.KEYCODE_LEFT_BRACKET,
                        KeyEvent.ACTION_UP,
                        0
                )
        );
        assertEquals(
                HardwareKeyActionResolver.Action.PASS_THROUGH,
                HardwareKeyActionResolver.resolve(
                        false,
                        KeyEvent.KEYCODE_LEFT_BRACKET,
                        KeyEvent.ACTION_DOWN,
                        0
                )
        );
    }

    @Test
    public void repeatedLeftBracketDoesNotFinishTwice() {
        assertEquals(
                HardwareKeyActionResolver.Action.CONSUME,
                HardwareKeyActionResolver.resolve(
                        true,
                        KeyEvent.KEYCODE_LEFT_BRACKET,
                        KeyEvent.ACTION_DOWN,
                        2
                )
        );
    }
}
