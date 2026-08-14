package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class HardwareKeyPressOwnershipTest {
    @Test
    public void ownershipRemainsStableUntilKeyUpRelease() {
        HardwareKeyPressOwnership ownership = new HardwareKeyPressOwnership();
        ownership.claim(67, HardwareKeyPressOwnership.Owner.WEB);
        ownership.claim(67, HardwareKeyPressOwnership.Owner.EDITOR);
        assertEquals(HardwareKeyPressOwnership.Owner.WEB, ownership.get(67));
        assertEquals(HardwareKeyPressOwnership.Owner.WEB, ownership.release(67));
        assertNull(ownership.get(67));
    }
}
