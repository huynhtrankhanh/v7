package com.huynhtrankhanh.v7ime;

import org.json.JSONObject;

import java.text.Normalizer;
import java.util.Locale;

final class PloverEntrySearch {
    static final int PAGE_SIZE = 500;

    private PloverEntrySearch() {}

    static JSONObject exactParams(String field, String query, int page) {
        JSONObject params = new JSONObject();
        try {
            params.put(field, query);
            params.put("match", "exact");
            params.put("sort", "alphabetic");
            params.put("page", page);
            params.put("page_size", PAGE_SIZE);
        } catch (Exception error) {
            throw new IllegalArgumentException("Could not build entry search", error);
        }
        return params;
    }

    static JSONObject listParams(int page) {
        JSONObject params = new JSONObject();
        try {
            params.put("sort", "alphabetic");
            params.put("page", page);
            params.put("page_size", PAGE_SIZE);
        } catch (Exception error) {
            throw new IllegalArgumentException("Could not build entry listing", error);
        }
        return params;
    }

    static String unicodeLookupKey(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFC).toLowerCase(Locale.ROOT);
    }

    static boolean shouldRequestNextPage(boolean hasMore, boolean ownsRequest) {
        return hasMore && ownsRequest;
    }
}
