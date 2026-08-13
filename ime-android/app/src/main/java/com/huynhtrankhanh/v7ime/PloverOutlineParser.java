package com.huynhtrankhanh.v7ime;

final class PloverOutlineParser {
    private static final String LEFT = "STKPWHR";
    private static final String VOWELS = "AO*EU";
    private static final String RIGHT = "FRPBLGTSDZ";

    private PloverOutlineParser() {}

    static boolean isCanonicalOutline(String outline) {
        if (outline == null || outline.isEmpty()) return false;
        String[] strokes = outline.split("/", -1);
        for (String stroke : strokes) {
            if (!isCanonicalStroke(stroke)) return false;
        }
        return true;
    }

    private static boolean isCanonicalStroke(String stroke) {
        if (stroke.isEmpty()) return false;
        int offset = stroke.charAt(0) == '#' ? 1 : 0;
        if (offset == stroke.length()) return false;

        int hyphen = stroke.indexOf('-', offset);
        if (hyphen >= 0) {
            if (stroke.indexOf('-', hyphen + 1) >= 0
                    || hyphen == stroke.length() - 1) return false;
            return ordered(stroke.substring(offset, hyphen), LEFT)
                    && ordered(stroke.substring(hyphen + 1), RIGHT);
        }

        int phase = 0;
        int last = -1;
        for (int index = offset; index < stroke.length(); index++) {
            char key = stroke.charAt(index);
            int nextPhase = phase;
            int position = LEFT.indexOf(key);
            if (phase <= 0 && position >= 0 && position > last) {
                last = position;
                continue;
            }
            nextPhase = 1;
            position = VOWELS.indexOf(key);
            if (phase <= 1 && position >= 0 && (phase < 1 || position > last)) {
                phase = nextPhase;
                last = position;
                continue;
            }
            nextPhase = 2;
            position = RIGHT.indexOf(key);
            if (position < 0 || (phase == 2 && position <= last)) return false;
            phase = nextPhase;
            last = position;
        }
        return true;
    }

    private static boolean ordered(String keys, String order) {
        int last = -1;
        for (int index = 0; index < keys.length(); index++) {
            int position = order.indexOf(keys.charAt(index));
            if (position <= last) return false;
            last = position;
        }
        return true;
    }
}
