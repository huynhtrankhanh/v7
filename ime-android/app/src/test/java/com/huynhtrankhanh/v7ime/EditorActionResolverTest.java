package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;

import android.view.inputmethod.EditorInfo;

import org.junit.Test;

public class EditorActionResolverTest {
    @Test
    public void returnsCustomActionBeforeStandardAction() {
        assertEquals(
                42,
                EditorActionResolver.resolve(EditorInfo.IME_ACTION_SEND, 42)
        );
    }

    @Test
    public void returnsStandardEditorAction() {
        assertEquals(
                EditorInfo.IME_ACTION_DONE,
                EditorActionResolver.resolve(EditorInfo.IME_ACTION_DONE, 0)
        );
    }

    @Test
    public void treatsNoneAndUnspecifiedAsPhysicalEnter() {
        assertEquals(
                0,
                EditorActionResolver.resolve(EditorInfo.IME_ACTION_NONE, 0)
        );
        assertEquals(
                0,
                EditorActionResolver.resolve(
                        EditorInfo.IME_ACTION_UNSPECIFIED,
                        0
                )
        );
    }

    @Test
    public void honorsActionEvenWhenNoEnterActionFlagIsSet() {
        assertEquals(
                EditorInfo.IME_ACTION_SEND,
                EditorActionResolver.resolve(
                        EditorInfo.IME_ACTION_SEND
                                | EditorInfo.IME_FLAG_NO_ENTER_ACTION,
                        0
                )
        );
    }
}
