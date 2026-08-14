package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.javascriptengine.SandboxDeadException;

import java.util.concurrent.ExecutionException;

import org.junit.Test;

public class ApplicationJavaScriptSandboxTest {
    @Test
    public void recognizesDirectAndWrappedSandboxDeath() {
        SandboxDeadException dead = new SandboxDeadException("sandbox exited");
        assertTrue(ApplicationJavaScriptSandbox.isSandboxDead(dead));
        assertTrue(ApplicationJavaScriptSandbox.isSandboxDead(
                new ExecutionException(dead)));
    }

    @Test
    public void doesNotInvalidateForOrdinaryIsolateErrors() {
        assertFalse(ApplicationJavaScriptSandbox.isSandboxDead(
                new IllegalStateException("bad script")));
        assertFalse(ApplicationJavaScriptSandbox.isSandboxDead(null));
    }
}
