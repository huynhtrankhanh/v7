package com.huynhtrankhanh.v7ime;

final class PloverCommandEditorMode {
    static final String RAW_OUTLINE_IME_OPTION =
            "com.huynhtrankhanh.v7ime.RAW_OUTLINE";
    static final String PLAIN_TEXT_IME_OPTION =
            "com.huynhtrankhanh.v7ime.PLAIN_TEXT";

    enum Mode {
        DEFAULT,
        RAW_OUTLINE,
        PLAIN_TEXT
    }

    private PloverCommandEditorMode() {}

    static Mode fromPrivateImeOptions(String privateImeOptions) {
        if (privateImeOptions == null) {
            return Mode.DEFAULT;
        }
        for (String option : privateImeOptions.split(",")) {
            String normalized = option.trim();
            if (RAW_OUTLINE_IME_OPTION.equals(normalized)) {
                return Mode.RAW_OUTLINE;
            }
            if (PLAIN_TEXT_IME_OPTION.equals(normalized)) {
                return Mode.PLAIN_TEXT;
            }
        }
        return Mode.DEFAULT;
    }
}
