package com.huynhtrankhanh.v7ime;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PloverEntrySearchTest {
    @Test
    public void entryListingUsesTheLargestProtocolPage() {
        JSONObject params = PloverEntrySearch.listParams(1);

        assertEquals(1, params.optInt("page"));
        assertEquals(500, params.optInt("page_size"));
    }

    @Test
    public void subsequentPagesRetainTheExactStrokeQuery() {
        JSONObject params = PloverEntrySearch.exactParams("stroke", "TEFT", 2);

        assertEquals("TEFT", params.optString("stroke"));
        assertEquals("exact", params.optString("match"));
        assertEquals(2, params.optInt("page"));
    }

    @Test
    public void unicodeLookupKeyFoldsVietnameseCaseAndNormalizesCombiningMarks() {
        assertEquals(PloverEntrySearch.unicodeLookupKey("đẹp"),
                PloverEntrySearch.unicodeLookupKey("Đẹp"));
        assertEquals(PloverEntrySearch.unicodeLookupKey("áo"),
                PloverEntrySearch.unicodeLookupKey("A\u0301o"));
    }

    @Test
    public void canceledRequestDoesNotScheduleAnotherPage() {
        assertTrue(PloverEntrySearch.shouldRequestNextPage(true, true));
        assertFalse(PloverEntrySearch.shouldRequestNextPage(true, false));
        assertFalse(PloverEntrySearch.shouldRequestNextPage(false, true));
    }
}
