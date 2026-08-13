package com.huynhtrankhanh.v7ime;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class LookupQueryGenerationTest {
    @Test
    public void editingInvalidatesAnInFlightRequest() {
        LookupQueryGeneration state = new LookupQueryGeneration();
        int request = state.submit();
        assertTrue(state.owns(request));

        state.edited();

        assertFalse(state.owns(request));
    }

    @Test
    public void aNewSubmissionSupersedesThePreviousOne() {
        LookupQueryGeneration state = new LookupQueryGeneration();
        int first = state.submit();
        int second = state.submit();

        assertFalse(state.owns(first));
        assertTrue(state.owns(second));
    }
}
