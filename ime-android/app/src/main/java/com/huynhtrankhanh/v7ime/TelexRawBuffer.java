package com.huynhtrankhanh.v7ime;

/** Native replay source of truth for one Telex PREEDIT word. */
final class TelexRawBuffer {
    private final StringBuilder raw = new StringBuilder();

    void append(String key) {
        raw.append(key);
    }

    boolean backspace() {
        if (raw.length() == 0) return false;
        int last = raw.offsetByCodePoints(raw.length(), -1);
        raw.delete(last, raw.length());
        return true;
    }

    boolean isEmpty() {
        return raw.length() == 0;
    }

    String text() {
        return raw.toString();
    }

    void clear() {
        raw.setLength(0);
    }
}
