package com.huynhtrankhanh.v7ime;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PloverLookupResultTest {
    @Test
    public void jsonNullAndAbsentTranslationsAreMisses() {
        assertTrue(PloverLookupResult.isMissingTranslation(null));
        assertTrue(PloverLookupResult.isMissingTranslation(JSONObject.NULL));
        assertTrue(PloverLookupResult.isMissingTranslation(""));
    }

    @Test
    public void actualTranslationsAreResults() {
        assertFalse(PloverLookupResult.isMissingTranslation("hello"));
    }
}
