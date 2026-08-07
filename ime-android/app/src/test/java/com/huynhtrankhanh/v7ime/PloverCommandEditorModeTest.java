package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class PloverCommandEditorModeTest {
    @Test
    public void recognizesCommandEditorModes() {
        assertEquals(
                PloverCommandEditorMode.Mode.RAW_OUTLINE,
                PloverCommandEditorMode.fromPrivateImeOptions(
                        PloverCommandEditorMode.RAW_OUTLINE_IME_OPTION
                )
        );
        assertEquals(
                PloverCommandEditorMode.Mode.PLAIN_TEXT,
                PloverCommandEditorMode.fromPrivateImeOptions(
                        "unrelated, "
                                + PloverCommandEditorMode.PLAIN_TEXT_IME_OPTION
                )
        );
    }

    @Test
    public void leavesUnmarkedEditorsInTheDefaultMode() {
        assertEquals(
                PloverCommandEditorMode.Mode.DEFAULT,
                PloverCommandEditorMode.fromPrivateImeOptions(null)
        );
        assertEquals(
                PloverCommandEditorMode.Mode.DEFAULT,
                PloverCommandEditorMode.fromPrivateImeOptions("unrelated")
        );
    }
}
