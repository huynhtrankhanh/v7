package com.huynhtrankhanh.v7ime;

import org.json.JSONObject;

final class PloverLookupResult {
    private PloverLookupResult() {}

    static boolean isMissingTranslation(Object translation) {
        return translation == null
                || translation == JSONObject.NULL
                || translation.toString().isEmpty();
    }
}
