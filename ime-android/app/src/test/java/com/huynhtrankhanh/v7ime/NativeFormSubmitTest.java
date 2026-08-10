package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;
import android.view.inputmethod.EditorInfo;

import org.junit.Test;

public class NativeFormSubmitTest {
    @Test
    public void acceptsStandardSubmissionEditorActions() {
        assertTrue(NativeFormSubmit.shouldSubmit(
                EditorInfo.IME_ACTION_DONE,
                KeyEvent.KEYCODE_UNKNOWN,
                -1
        ));
        assertTrue(NativeFormSubmit.shouldSubmit(
                EditorInfo.IME_ACTION_NONE,
                KeyEvent.KEYCODE_NUMPAD_ENTER,
                KeyEvent.ACTION_DOWN
        ));
        assertTrue(NativeFormSubmit.shouldSubmit(
                EditorInfo.IME_ACTION_GO,
                KeyEvent.KEYCODE_UNKNOWN,
                -1
        ));
        assertTrue(NativeFormSubmit.shouldSubmit(
                EditorInfo.IME_ACTION_SEND,
                KeyEvent.KEYCODE_UNKNOWN,
                -1
        ));
    }

    @Test
    public void acceptsHardwareEnterDownOnly() {
        assertTrue(NativeFormSubmit.shouldSubmit(
                EditorInfo.IME_ACTION_NONE,
                KeyEvent.KEYCODE_ENTER,
                KeyEvent.ACTION_DOWN
        ));
        assertFalse(NativeFormSubmit.shouldSubmit(
                EditorInfo.IME_ACTION_NONE,
                KeyEvent.KEYCODE_ENTER,
                KeyEvent.ACTION_UP
        ));
    }

    @Test
    public void rejectsUnrelatedActionsAndKeys() {
        assertFalse(NativeFormSubmit.shouldSubmit(
                EditorInfo.IME_ACTION_NEXT,
                KeyEvent.KEYCODE_UNKNOWN,
                -1
        ));
        assertFalse(NativeFormSubmit.shouldSubmit(
                EditorInfo.IME_ACTION_NONE,
                KeyEvent.KEYCODE_TAB,
                KeyEvent.ACTION_DOWN
        ));
    }
}
