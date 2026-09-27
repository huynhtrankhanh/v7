package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Shared by the IME bridge and Settings, independently of WebView lifetime. */
final class ClipboardSlotStore {
    private final SharedPreferences preferences;

    ClipboardSlotStore(Context context) {
        preferences = context.getSharedPreferences("clipboard_slots", Context.MODE_PRIVATE);
    }

    SharedPreferences preferences() {
        return preferences;
    }

    String get(int slot) {
        return valid(slot) ? preferences.getString("slot_" + slot, null) : null;
    }

    boolean set(int slot, String text) {
        if (!valid(slot)) return false;
        synchronized (preferences) {
            SharedPreferences.Editor editor = preferences.edit().putBoolean("migrated", true);
            if (text == null || text.isEmpty()) editor.remove("slot_" + slot);
            else editor.putString("slot_" + slot, text);
            return editor.commit();
        }
    }

    boolean clear() {
        synchronized (preferences) {
            return preferences.edit().clear().putBoolean("migrated", true).commit();
        }
    }

    String toJson() {
        synchronized (preferences) {
            JSONArray array = new JSONArray();
            for (int slot = 0; slot < 10; slot++) {
                String text = get(slot);
                array.put(text == null ? JSONObject.NULL : text);
            }
            return array.toString();
        }
    }

    boolean migrate(String json) {
        // Context returns the same preferences instance to Settings and the
        // bridge. Serialize migration with edits so it cannot overwrite them.
        synchronized (preferences) {
            if (preferences.getBoolean("migrated", false)) return true;
            try {
                JSONArray array = new JSONArray(json);
                if (array.length() != 10) return false;
                for (int slot = 0; slot < 10; slot++) {
                    Object value = array.get(slot);
                    if (value != JSONObject.NULL && !(value instanceof String)) return false;
                }
                SharedPreferences.Editor editor = preferences.edit();
                for (int slot = 0; slot < 10; slot++) {
                    if (!array.isNull(slot) && !array.getString(slot).isEmpty()) {
                        editor.putString("slot_" + slot, array.getString(slot));
                    }
                }
                return editor.putBoolean("migrated", true).commit();
            } catch (JSONException error) {
                return false;
            }
        }
    }

    private boolean valid(int slot) {
        return slot >= 0 && slot < 10;
    }
}
