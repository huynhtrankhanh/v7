package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class KeyboardVisibilityControllerTest {
    @Test
    public void externalKeyboardAttachRequestsRecoveryDuringActiveInput() {
        KeyboardVisibilityController controller = initializedController();
        controller.startInput();

        assertTrue(controller.onConfigurationChanged(2, 1, 2));
        long generation = controller.beginRecovery();

        assertTrue(controller.shouldRunRecovery(generation));
    }

    @Test
    public void externalKeyboardDetachRequestsRecoveryDuringActiveInput() {
        KeyboardVisibilityController controller = new KeyboardVisibilityController();
        controller.initializeConfiguration(2, 1, 2);
        controller.startInput();

        assertTrue(controller.onConfigurationChanged(1, 1, 1));
    }

    @Test
    public void hardKeyboardVisibilityChangeRequestsRecovery() {
        KeyboardVisibilityController controller = initializedController();
        controller.startInput();

        assertTrue(controller.onConfigurationChanged(1, 1, 2));
    }

    @Test
    public void unrelatedConfigurationChangeDoesNotRequestRecovery() {
        KeyboardVisibilityController controller = initializedController();
        controller.startInput();

        assertFalse(controller.onConfigurationChanged(1, 1, 1));
    }

    @Test
    public void keyboardChangeWithoutActiveEditorDoesNotRequestRecovery() {
        KeyboardVisibilityController controller = initializedController();

        assertFalse(controller.onConfigurationChanged(2, 1, 2));
        assertEquals(
                KeyboardVisibilityController.NO_RECOVERY,
                controller.beginRecovery()
        );
    }

    @Test
    public void finishedInputInvalidatesPostedRecovery() {
        KeyboardVisibilityController controller = initializedController();
        controller.startInput();
        assertTrue(controller.onConfigurationChanged(2, 1, 2));
        long generation = controller.beginRecovery();

        controller.finishInput();

        assertFalse(controller.shouldRunRecovery(generation));
        assertFalse(controller.shouldAllowInputView());
    }

    @Test
    public void aNewEditorInvalidatesRecoveryForThePreviousEditor() {
        KeyboardVisibilityController controller = initializedController();
        controller.startInput();
        long previousGeneration = controller.beginRecovery();

        controller.finishInput();
        controller.startInput();

        assertFalse(controller.shouldRunRecovery(previousGeneration));
        assertTrue(controller.shouldAllowInputView());
    }

    private KeyboardVisibilityController initializedController() {
        KeyboardVisibilityController controller = new KeyboardVisibilityController();
        controller.initializeConfiguration(1, 1, 1);
        return controller;
    }
}
