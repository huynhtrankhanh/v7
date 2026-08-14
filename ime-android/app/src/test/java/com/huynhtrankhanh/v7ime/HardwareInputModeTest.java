package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class HardwareInputModeTest {
    @Test
    public void controlTabCoversEveryRequestedEdge() {
        assertEquals(HardwareInputMode.TELEX,
                HardwareInputMode.V7_PLOVER.onControlTab().mode);
        assertEquals(HardwareInputMode.V7_PLOVER,
                HardwareInputMode.TELEX.onControlTab().mode);
        assertEquals(HardwareInputMode.TELEX,
                HardwareInputMode.NORMAL.onControlTab().mode);
    }

    @Test
    public void controlShiftCoversEveryRequestedEdge() {
        assertEquals(HardwareInputMode.NORMAL,
                HardwareInputMode.V7_PLOVER.onControlShift().mode);
        assertEquals(HardwareInputMode.NORMAL,
                HardwareInputMode.TELEX.onControlShift().mode);
        assertEquals(HardwareInputMode.V7_PLOVER,
                HardwareInputMode.NORMAL.onControlShift().mode);
    }

    @Test
    public void everyModeShortcutFinalizesPreedit() {
        for (HardwareInputMode mode : HardwareInputMode.values()) {
            assertTrue(mode.onControlTab().finishPreedit);
            assertTrue(mode.onControlShift().finishPreedit);
        }
    }

    @Test
    public void rawOutlineAlwaysOverridesStoredTelexMode() {
        assertTrue(HardwareInputMode.TELEX.usesNativeTelex(false));
        assertFalse(HardwareInputMode.TELEX.usesNativeTelex(true));
        assertFalse(HardwareInputMode.V7_PLOVER.usesNativeTelex(false));
        assertFalse(HardwareInputMode.NORMAL.usesNativeTelex(false));
    }
}
