package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(RobolectricTestRunner.class)
public class TelexJavaScriptSandboxTest {
    @Test
    public void closePreventsQueuedWarmupFromReopeningSandbox() {
        TelexJavaScriptSandbox sandbox = new TelexJavaScriptSandbox(
                RuntimeEnvironment.getApplication());
        AtomicReference<Runnable> queuedWarmup = new AtomicReference<>();
        AtomicInteger callbacks = new AtomicInteger();

        sandbox.warmAsync(queuedWarmup::set, callbacks::incrementAndGet);
        assertNotNull(queuedWarmup.get());

        sandbox.close();
        queuedWarmup.get().run();

        assertFalse(sandbox.isReady());
        assertEquals(0, callbacks.get());
    }
}
