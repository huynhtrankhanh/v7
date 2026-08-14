package com.huynhtrankhanh.v7ime;

import android.content.Context;

import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.JavaScriptSandbox;
import androidx.javascriptengine.SandboxDeadException;

import com.google.common.util.concurrent.ListenableFuture;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Process-wide JavaScriptSandbox owner. Callers create independent isolates. */
final class ApplicationJavaScriptSandbox {
    private static JavaScriptSandbox sandbox;

    private ApplicationJavaScriptSandbox() {
    }

    static synchronized JavaScriptSandbox get(
            Context context, long timeout, TimeUnit unit) throws Exception {
        if (sandbox == null) {
            if (!JavaScriptSandbox.isSupported()) {
                throw new IllegalStateException("JavaScriptSandbox is unavailable");
            }
            ListenableFuture<JavaScriptSandbox> connection =
                    JavaScriptSandbox.createConnectedInstanceAsync(
                            context.getApplicationContext());
            sandbox = awaitConnection(connection, timeout, unit);
        }
        return sandbox;
    }

    static <T> T awaitConnection(
            ListenableFuture<T> connection, long timeout, TimeUnit unit)
            throws Exception {
        try {
            return connection.get(timeout, unit);
        } catch (TimeoutException timeoutError) {
            // AndroidX attaches its service-unbind cleanup to cancellation.
            // If completion won the race, retain that sole valid instance.
            if (!connection.cancel(true)) return connection.get();
            throw timeoutError;
        }
    }

    static JavaScriptIsolate createIsolate(
            Context context, long timeout, TimeUnit unit) throws Exception {
        return get(context, timeout, unit).createIsolate();
    }

    static synchronized void invalidate(JavaScriptSandbox expected) {
        if (expected == null || sandbox != expected) return;
        sandbox.close();
        sandbox = null;
    }

    static boolean isSandboxDead(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof SandboxDeadException) return true;
            current = current.getCause();
        }
        return false;
    }
}
