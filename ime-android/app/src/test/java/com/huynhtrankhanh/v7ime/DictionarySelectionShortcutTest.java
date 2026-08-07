package com.huynhtrankhanh.v7ime;

import android.view.KeyEvent;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class DictionarySelectionShortcutTest {
    @Test
    public void numberRowAndNumpadSelectVisibleDictionaryNumbers() {
        assertEquals(0, DictionarySelectionShortcut.indexFor(
                KeyEvent.KEYCODE_1,
                5
        ));
        assertEquals(4, DictionarySelectionShortcut.indexFor(
                KeyEvent.KEYCODE_NUMPAD_5,
                5
        ));
    }

    @Test
    public void ignoresUnavailableNumbersAndUnrelatedKeys() {
        assertEquals(-1, DictionarySelectionShortcut.indexFor(
                KeyEvent.KEYCODE_5,
                4
        ));
        assertEquals(-1, DictionarySelectionShortcut.indexFor(
                KeyEvent.KEYCODE_DPAD_DOWN,
                9
        ));
        assertEquals(-1, DictionarySelectionShortcut.indexFor(
                KeyEvent.KEYCODE_1,
                9,
                false
        ));
    }
}
