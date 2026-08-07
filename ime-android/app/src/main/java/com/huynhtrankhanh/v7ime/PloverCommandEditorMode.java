package com.huynhtrankhanh.v7ime;

final class PloverCommandEditorMode {
    static final String RAW_OUTLINE_IME_OPTION =
            "com.huynhtrankhanh.v7ime.RAW_OUTLINE";
    enum Mode {
        DEFAULT,
        RAW_OUTLINE
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
        }
        return Mode.DEFAULT;
    }
}
