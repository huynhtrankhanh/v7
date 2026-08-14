package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;

import org.junit.Test;

public class TelexHardwareKeyPolicyTest {
    private final TelexHardwareKeyPolicy policy = new TelexHardwareKeyPolicy();

    @Test
    public void emptyPreeditBackspaceReturnsToEditor() {
        assertEquals(TelexHardwareKeyPolicy.Route.EDITOR,
                policy.resolve(KeyEvent.KEYCODE_DEL, false, false));
        assertEquals(TelexHardwareKeyPolicy.Route.WEB_PREEDIT,
                policy.resolve(KeyEvent.KEYCODE_DEL, true, false));
        assertEquals(TelexHardwareKeyPolicy.Route.WEB_PREEDIT,
                policy.resolve(KeyEvent.KEYCODE_DEL, false, true));
    }

    @Test
    public void enterAlwaysUsesNativeEditorActionPath() {
        assertEquals(TelexHardwareKeyPolicy.Route.EDITOR_ENTER,
                policy.resolve(KeyEvent.KEYCODE_ENTER, false, false));
        assertEquals(TelexHardwareKeyPolicy.Route.EDITOR_ENTER,
                policy.resolve(KeyEvent.KEYCODE_NUMPAD_ENTER, true, false));
        assertTrue(policy.dispatchKeyUpToEditor(KeyEvent.KEYCODE_ENTER));
        assertTrue(policy.dispatchKeyUpToEditor(KeyEvent.KEYCODE_NUMPAD_ENTER));
        assertFalse(policy.dispatchKeyUpToEditor(KeyEvent.KEYCODE_A));
    }

    @Test
    public void escapeReturnsToEditor() {
        assertEquals(TelexHardwareKeyPolicy.Route.EDITOR,
                policy.resolve(KeyEvent.KEYCODE_ESCAPE, true, false));
    }
}
