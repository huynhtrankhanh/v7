package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;

import android.view.KeyEvent;

import org.junit.Test;

public class TelexHardwareKeyPolicyTest {
    private final TelexHardwareKeyPolicy policy = new TelexHardwareKeyPolicy();

    @Test
    public void emptyPreeditBackspaceReturnsToEditor() {
        assertEquals(TelexHardwareKeyPolicy.Route.EDITOR,
                policy.resolve(KeyEvent.KEYCODE_DEL, false));
        assertEquals(TelexHardwareKeyPolicy.Route.WEB_PREEDIT,
                policy.resolve(KeyEvent.KEYCODE_DEL, true));
    }

    @Test
    public void enterAlwaysUsesNativeEditorActionPath() {
        assertEquals(TelexHardwareKeyPolicy.Route.EDITOR_ENTER,
                policy.resolve(KeyEvent.KEYCODE_ENTER, false));
        assertEquals(TelexHardwareKeyPolicy.Route.EDITOR_ENTER,
                policy.resolve(KeyEvent.KEYCODE_NUMPAD_ENTER, true));
    }

    @Test
    public void escapeReturnsToEditor() {
        assertEquals(TelexHardwareKeyPolicy.Route.EDITOR,
                policy.resolve(KeyEvent.KEYCODE_ESCAPE, true));
    }
}
