package com.huynhtrankhanh.v7ime;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class KeyboardFocusCycleTest {
    @Test
    public void cyclesForwardAndBackward() {
        boolean[] eligible = {true, true, true};

        assertEquals(1, KeyboardFocusCycle.nextIndex(0, false, eligible));
        assertEquals(0, KeyboardFocusCycle.nextIndex(2, false, eligible));
        assertEquals(2, KeyboardFocusCycle.nextIndex(0, true, eligible));
    }

    @Test
    public void skipsDisabledControlsAndHandlesMissingFocus() {
        boolean[] eligible = {true, false, true};

        assertEquals(2, KeyboardFocusCycle.nextIndex(0, false, eligible));
        assertEquals(2, KeyboardFocusCycle.nextIndex(-1, true, eligible));
        assertEquals(-1, KeyboardFocusCycle.nextIndex(1, false, new boolean[0]));
        assertEquals(-1, KeyboardFocusCycle.nextIndex(1, false, new boolean[]{false}));
    }
}
