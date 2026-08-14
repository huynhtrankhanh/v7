package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;

public class HardwareEventBarrierQueueTest {
    @Test
    public void replaysPostBarrierInputInPhysicalOrder() {
        HardwareEventBarrierQueue<String> queue = new HardwareEventBarrierQueue<>();
        queue.begin(7);
        assertTrue(queue.offerIfActive("A-down"));
        assertTrue(queue.offerIfActive("A-up"));

        assertEquals(Arrays.asList("A-down", "A-up"), queue.finish(7, true));
        assertFalse(queue.offerIfActive("B-down"));
    }

    @Test
    public void staleBarrierCannotReleaseInputAndCancellationDropsIt() {
        HardwareEventBarrierQueue<String> queue = new HardwareEventBarrierQueue<>();
        queue.begin(9);
        queue.offerIfActive("next-word");

        assertEquals(Collections.emptyList(), queue.finish(8, true));
        assertTrue(queue.offerIfActive("next-word-up"));
        assertEquals(Collections.emptyList(), queue.finish(9, false));
        assertFalse(queue.offerIfActive("later"));
    }
}
