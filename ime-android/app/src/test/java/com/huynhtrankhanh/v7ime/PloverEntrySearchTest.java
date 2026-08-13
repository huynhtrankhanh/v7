package com.huynhtrankhanh.v7ime;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

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
        LookupQueryGeneration generation = new LookupQueryGeneration();
        int request = generation.submit();
        int[] requestedPages = {1};

        generation.edited();
        if (PloverEntrySearch.shouldRequestNextPage(true, generation.owns(request))) {
            requestedPages[0] += 1;
        }

        assertEquals(1, requestedPages[0]);
        assertFalse(generation.owns(request));
        assertFalse(PloverEntrySearch.shouldRequestNextPage(false, true));
    }
}
