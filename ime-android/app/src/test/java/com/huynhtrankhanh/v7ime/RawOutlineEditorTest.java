package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class RawOutlineEditorTest {
    @Test
    public void doesNothingWithoutTextBeforeCursor() {
        assertEquals(0, RawOutlineEditor.deletionLength(null));
        assertEquals(0, RawOutlineEditor.deletionLength(""));
    }

    @Test
    public void removesTheOnlyStroke() {
        assertEquals(7, RawOutlineEditor.deletionLength("STKPWHR"));
    }

    @Test
    public void removesTheLastStrokeAndItsSeparator() {
        assertEquals(5, RawOutlineEditor.deletionLength("STKPWHR/AOEU"));
        assertEquals(2, RawOutlineEditor.deletionLength("S/T"));
    }
}
