package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class HardwareKeyPressOwnershipTest {
    @Test
    public void ownershipRemainsStableUntilKeyUpRelease() {
        HardwareKeyPressOwnership ownership = new HardwareKeyPressOwnership();
        ownership.claim(67, HardwareKeyPressOwnership.Owner.WEB, 4);
        ownership.claim(67, HardwareKeyPressOwnership.Owner.EDITOR, 4);
        assertEquals(HardwareKeyPressOwnership.Owner.WEB,
                ownership.get(67).owner);
        assertEquals(4, ownership.get(67).generation);
        assertEquals(HardwareKeyPressOwnership.Owner.WEB,
                ownership.release(67).owner);
        assertNull(ownership.get(67));
    }

    @Test
    public void freshDownReplacesAClaimFromAnOlderEpoch() {
        HardwareKeyPressOwnership ownership = new HardwareKeyPressOwnership();
        ownership.claim(29, HardwareKeyPressOwnership.Owner.WEB, 8);
        ownership.claim(29, HardwareKeyPressOwnership.Owner.WEB, 9);
        assertEquals(9, ownership.get(29).generation);
        assertFalse(ownership.get(29).belongsTo(8));
        assertTrue(ownership.get(29).belongsTo(9));
    }

    @Test
    public void invalidationSuppressesRemainderButAllowsANewPress() {
        HardwareKeyPressOwnership ownership = new HardwareKeyPressOwnership();
        ownership.claim(29, HardwareKeyPressOwnership.Owner.WEB, 8);
        ownership.invalidate();
        assertFalse(ownership.get(29).belongsTo(9));
        ownership.claim(29, HardwareKeyPressOwnership.Owner.WEB, 9);
        assertTrue(ownership.get(29).belongsTo(9));
    }

    @Test
    public void nativePressCanTransferToEditorDuringARepeat() {
        HardwareKeyPressOwnership ownership = new HardwareKeyPressOwnership();
        ownership.claim(67, HardwareKeyPressOwnership.Owner.NATIVE, 8);
        ownership.claim(67, HardwareKeyPressOwnership.Owner.EDITOR, 8);
        assertEquals(HardwareKeyPressOwnership.Owner.NATIVE,
                ownership.get(67).owner);

        ownership.transfer(67, HardwareKeyPressOwnership.Owner.EDITOR, 8);

        assertEquals(HardwareKeyPressOwnership.Owner.EDITOR,
                ownership.get(67).owner);
        assertEquals(HardwareKeyPressOwnership.Owner.EDITOR,
                ownership.release(67).owner);
    }

    @Test
    public void repeatCanRefreshTheSameNativePressGeneration() {
        HardwareKeyPressOwnership ownership = new HardwareKeyPressOwnership();
        ownership.claim(62, HardwareKeyPressOwnership.Owner.NATIVE, 8);
        HardwareKeyPressOwnership.Claim claim = ownership.get(62);

        assertTrue(ownership.refresh(62, claim, 9));
        assertEquals(HardwareKeyPressOwnership.Owner.NATIVE,
                ownership.get(62).owner);
        assertTrue(ownership.get(62).belongsTo(9));
    }

    @Test
    public void staleRepeatCannotRefreshAnInvalidatedPress() {
        HardwareKeyPressOwnership ownership = new HardwareKeyPressOwnership();
        ownership.claim(62, HardwareKeyPressOwnership.Owner.NATIVE, 8);
        HardwareKeyPressOwnership.Claim staleClaim = ownership.get(62);

        ownership.invalidate();

        assertFalse(ownership.refresh(62, staleClaim, 9));
        assertFalse(ownership.get(62).belongsTo(9));
    }

}
