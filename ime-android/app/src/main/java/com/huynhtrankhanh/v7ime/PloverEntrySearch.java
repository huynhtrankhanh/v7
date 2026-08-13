package com.huynhtrankhanh.v7ime;

import org.json.JSONObject;

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
}
