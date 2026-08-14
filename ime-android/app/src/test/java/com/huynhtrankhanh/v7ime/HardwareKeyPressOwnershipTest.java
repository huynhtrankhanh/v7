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
}
