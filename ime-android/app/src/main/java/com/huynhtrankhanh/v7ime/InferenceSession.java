package com.huynhtrankhanh.v7ime;

import java.io.IOException;
import java.util.concurrent.Executor;
import java.util.function.LongSupplier;

/** Owns resources for the process-wide native inference engine. */
final class InferenceSession {
    static final long DICTIONARY_REFRESH_MILLIS = 1000;

    interface Resources {
        // Ownership of the detached descriptor transfers to Backend.infer.
        int openModel(String uri) throws IOException;
        String dictionaryVersion(String uri) throws IOException;
        String readDictionary(String uri) throws IOException;
    }

    interface Backend {
        String infer(int modelFd, String modelId, String dictionaryId,
                     String dictionarySource, String request) throws IOException;
    }

    private final Backend backend;
    private final Executor refreshExecutor;
    private final LongSupplier clock;
    private String loadedModelId;
    private final Object dictionaryLock = new Object();
    private Dictionary dictionary;
    private IOException dictionaryError;
    private long dictionaryRevision;
    private long nextRefresh;
    private boolean refreshing;

    InferenceSession(Backend backend, Executor refreshExecutor, LongSupplier clock) {
        this.backend = backend;
        this.refreshExecutor = refreshExecutor;
        this.clock = clock;
    }

    // Serialize warm-up and input so the cached model identity cannot race a switch.
    synchronized String infer(Resources resources, String modelId, String dictionaryUri,
                              boolean needsDictionary, String request) throws IOException {
        Dictionary selected = needsDictionary ? getDictionary(resources, dictionaryUri) : null;
        int fd = modelId.equals(loadedModelId) ? -1 : resources.openModel(modelId);
        // A failed request may still have replaced the native engine.
        loadedModelId = null;
        String response = backend.infer(fd, modelId,
                selected == null ? "__unchanged__" : selected.id(),
                selected == null ? "" : selected.source, request);
        loadedModelId = modelId;
        return response;
    }

    synchronized void invalidateDictionary() {
        synchronized (dictionaryLock) {
            dictionary = null;
            dictionaryError = null;
            refreshing = false;
        }
    }

    private Dictionary getDictionary(Resources resources, String uri) throws IOException {
        Dictionary cached;
        synchronized (dictionaryLock) {
            cached = dictionary;
        }
        if (cached == null || !cached.uri.equals(uri)) {
            String version = uri.isEmpty() ? "bundled" : resources.dictionaryVersion(uri);
            String source = uri.isEmpty() ? "" : resources.readDictionary(uri);
            synchronized (dictionaryLock) {
                cached = new Dictionary(uri, version, source, ++dictionaryRevision);
                dictionary = cached;
                dictionaryError = null;
                refreshing = false;
                nextRefresh = clock.getAsLong() + DICTIONARY_REFRESH_MILLIS;
            }
        }
        Dictionary refresh = null;
        IOException error;
        synchronized (dictionaryLock) {
            cached = dictionary;
            if (!uri.isEmpty() && !refreshing && clock.getAsLong() >= nextRefresh) {
                refreshing = true;
                refresh = cached;
            }
            error = dictionaryError;
        }
        if (refresh != null) {
            Dictionary expected = refresh;
            refreshExecutor.execute(() -> refreshDictionary(resources, expected));
        }
        if (error != null) throw error;
        return cached;
    }

    private void refreshDictionary(Resources resources, Dictionary expected) {
        String version = expected.version;
        String source = expected.source;
        IOException error = null;
        try {
            version = resources.dictionaryVersion(expected.uri);
            if (!version.equals(expected.version)) {
                source = resources.readDictionary(expected.uri);
            }
        } catch (IOException failure) {
            error = failure;
        }
        synchronized (dictionaryLock) {
            // A selection change or invalidation supersedes this provider read.
            if (dictionary != expected) return;
            if (error == null && !version.equals(expected.version)) {
                dictionary = new Dictionary(expected.uri, version, source, ++dictionaryRevision);
            }
            dictionaryError = error;
            refreshing = false;
            nextRefresh = clock.getAsLong() + DICTIONARY_REFRESH_MILLIS;
        }
    }

    private static final class Dictionary {
        final String uri;
        final String version;
        final String source;
        final long revision;

        Dictionary(String uri, String version, String source, long revision) {
            this.uri = uri;
            this.version = version;
            this.source = source;
            this.revision = revision;
        }

        String id() {
            // Reselecting a document also reloads providers without version metadata.
            return uri.isEmpty() ? "" : uri + ":" + revision;
        }
    }
}
