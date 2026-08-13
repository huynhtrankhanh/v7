package com.huynhtrankhanh.v7ime;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class PloverEntrySearchTest {
    @Test
    public void translationSearchUsesCaseInsensitiveExactEntryQuery() {
        JSONObject params = PloverEntrySearch.exactParams("output", "Test", 1);
        JSONObject lowercase = PloverEntrySearch.exactParams("output", "test", 1);

        assertEquals("Test", params.optString("output"));
        assertEquals("exact", params.optString("match"));
        assertEquals("test", lowercase.optString("output"));
        assertEquals(params.optString("match"), lowercase.optString("match"));
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
}
