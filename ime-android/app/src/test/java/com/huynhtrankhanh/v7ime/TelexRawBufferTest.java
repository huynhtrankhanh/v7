package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TelexRawBufferTest {
    @Test
    public void backspaceReplaysNativeRawCodePoints() {
        TelexRawBuffer buffer = new TelexRawBuffer();
        buffer.append("D");
        buffer.append("đ");
        buffer.append("𐐀");

        assertTrue(buffer.backspace());
        assertEquals("Dđ", buffer.text());
        assertTrue(buffer.backspace());
        assertEquals("D", buffer.text());
        assertTrue(buffer.backspace());
        assertTrue(buffer.isEmpty());
        assertFalse(buffer.backspace());
    }

    @Test
    public void clearStartsANewNativeWord() {
        TelexRawBuffer buffer = new TelexRawBuffer();
        buffer.append("tieengs");
        buffer.clear();
        assertEquals("", buffer.text());
    }
}
