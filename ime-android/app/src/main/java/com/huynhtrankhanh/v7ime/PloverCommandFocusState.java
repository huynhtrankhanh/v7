package com.huynhtrankhanh.v7ime;

/**
 * Tells the IME when a native command control, rather than an editor, owns
 * focus. Android can otherwise keep the last EditText's InputConnection alive
 * and route radio-button shortcuts back through steno capture.
 */
final class PloverCommandFocusState {
    private static volatile boolean nativeControlFocused;

    private PloverCommandFocusState() {
    }

    static void setNativeControlFocused(boolean focused) {
        nativeControlFocused = focused;
    }

    static boolean shouldPassHardwareKeysToActivity() {
        return nativeControlFocused;
    }
}
