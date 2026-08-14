package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.javascriptengine.SandboxDeadException;

import com.google.common.util.concurrent.SettableFuture;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

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

    @Test
    public void timeoutCancelsConnectionSoAndroidXCanUnbind() throws Exception {
        SettableFuture<String> connection = SettableFuture.create();
        try {
            ApplicationJavaScriptSandbox.awaitConnection(
                    connection, 1, TimeUnit.MILLISECONDS);
        } catch (TimeoutException expected) {
            assertTrue(connection.isCancelled());
            return;
        }
        throw new AssertionError("Expected the connection to time out");
    }
}
