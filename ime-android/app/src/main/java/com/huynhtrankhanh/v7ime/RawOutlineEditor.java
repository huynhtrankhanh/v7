package com.huynhtrankhanh.v7ime;

final class RawOutlineEditor {
    static final int MAX_CONTEXT_LENGTH = 4096;

    private RawOutlineEditor() {
    }

    /**
     * Returns the number of characters to delete before the cursor to remove
     * the last slash-delimited stroke, including its leading slash.
     */
    static int deletionLength(CharSequence textBeforeCursor) {
        if (textBeforeCursor == null || textBeforeCursor.length() == 0) {
            return 0;
        }
        int lastSlash = -1;
        for (int index = textBeforeCursor.length() - 1; index >= 0; index--) {
            if (textBeforeCursor.charAt(index) == '/') {
                lastSlash = index;
                break;
            }
        }
        return lastSlash < 0
                ? textBeforeCursor.length()
                : textBeforeCursor.length() - lastSlash;
    }
}
