package com.huynhtrankhanh.v7ime;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class GenerationOwnershipTest {
    @Test
    public void onlyNewestKeyboardComponentRetainsControl() {
        GenerationOwnership<Object> ownership = new GenerationOwnership<>();
        Object staleKeyboard = new Object();
        Object controllingKeyboard = new Object();

        int staleGeneration = ownership.claim(staleKeyboard);
        int controllingGeneration = ownership.claim(controllingKeyboard);

        assertFalse(ownership.isCurrent(staleKeyboard, staleGeneration));
        assertTrue(ownership.isCurrent(
                controllingKeyboard,
                controllingGeneration
        ));
        ownership.release(controllingKeyboard, controllingGeneration);
        assertFalse(ownership.isCurrent(
                controllingKeyboard,
                controllingGeneration
        ));
    }
}
