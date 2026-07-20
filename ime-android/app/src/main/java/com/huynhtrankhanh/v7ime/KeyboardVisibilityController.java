package com.huynhtrankhanh.v7ime;

/**
 * Keeps Android configuration bookkeeping separate from the IME window calls.
 *
 * <p>The integer values deliberately mirror {@code Configuration}'s keyboard
 * fields without importing Android classes, so the policy can be unit-tested
 * on the host JVM.</p>
 */
final class KeyboardVisibilityController {
    static final long NO_RECOVERY = -1L;

    private boolean configurationInitialized;
    private int keyboard;
    private int keyboardHidden;
    private int hardKeyboardHidden;
    private boolean inputActive;
    private long inputGeneration;

    void initializeConfiguration(
            int keyboard,
            int keyboardHidden,
            int hardKeyboardHidden) {
        this.keyboard = keyboard;
        this.keyboardHidden = keyboardHidden;
        this.hardKeyboardHidden = hardKeyboardHidden;
        configurationInitialized = true;
    }

    void startInput() {
        inputActive = true;
        inputGeneration++;
    }

    void finishInput() {
        inputActive = false;
        inputGeneration++;
    }

    boolean onConfigurationChanged(
            int keyboard,
            int keyboardHidden,
            int hardKeyboardHidden) {
        boolean keyboardEnvironmentChanged = configurationInitialized
                && (this.keyboard != keyboard
                || this.keyboardHidden != keyboardHidden
                || this.hardKeyboardHidden != hardKeyboardHidden);
        initializeConfiguration(keyboard, keyboardHidden, hardKeyboardHidden);
        return keyboardEnvironmentChanged && inputActive;
    }

    long beginRecovery() {
        return inputActive ? inputGeneration : NO_RECOVERY;
    }

    boolean shouldRunRecovery(long generation) {
        return inputActive && generation == inputGeneration;
    }

    boolean shouldAllowInputView() {
        return inputActive;
    }
}
