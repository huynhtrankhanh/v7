package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class TelexPreeditStateTest {
    @Test
    public void finalizerTakesNewestTextBeforePostedUiUpdate() {
        TelexPreeditState state = new TelexPreeditState();
        state.remember("tiêng", 4);
        state.remember("tiếng", 4);
        assertEquals("tiếng", state.take(4));
        assertNull(state.take(4));
    }

    @Test
    public void staleEditorGenerationCannotTakeText() {
        TelexPreeditState state = new TelexPreeditState();
        state.remember("old word", 7);
        assertNull(state.take(8));
        assertEquals("old word", state.take(7));
    }
}
