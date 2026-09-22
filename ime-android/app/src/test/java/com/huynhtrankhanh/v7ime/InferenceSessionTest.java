package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.*;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class InferenceSessionTest {
    private final ArrayDeque<Runnable> refreshes = new ArrayDeque<>();
    private final List<Integer> descriptors = new ArrayList<>();
    private final List<String> dictionaryIds = new ArrayList<>();
    private final List<String> sources = new ArrayList<>();
    private long now;
    private boolean failInference;
    private final Provider provider = new Provider();
    private final InferenceSession session = new InferenceSession(
            (fd, model, dictionary, source, request) -> {
                descriptors.add(fd);
                dictionaryIds.add(dictionary);
                sources.add(source);
                if (failInference) throw new IOException("inference failed");
                return "{}";
            }, refreshes::add, () -> now);

    private void infer(String model, String dictionary, boolean needsDictionary) throws IOException {
        session.infer(provider, model, dictionary, needsDictionary, "{}");
    }

    @Test
    public void warmModelAndDictionaryAreReusedAcrossStrokes() throws Exception {
        infer("model", "dictionary", true);
        for (int i = 0; i < 100; i++) infer("model", "dictionary", true);
        assertEquals(1, provider.opens);
        assertEquals(1, provider.queries);
        assertEquals(1, provider.reads);
        assertEquals(Integer.valueOf(-1), descriptors.get(100));
        assertEquals(dictionaryIds.get(0), dictionaryIds.get(100));
    }

    @Test
    public void providerChecksRunOffTheTypingPathAndCoalesce() throws Exception {
        infer("model", "dictionary", true);
        now = InferenceSession.DICTIONARY_REFRESH_MILLIS;
        for (int i = 0; i < 100; i++) infer("model", "dictionary", true);
        assertEquals(1, provider.queries);
        assertEquals(1, refreshes.size());
        refreshes.remove().run();
        assertEquals(2, provider.queries);
        assertEquals(1, provider.reads);
        infer("model", "dictionary", true);
        assertEquals(dictionaryIds.get(0), dictionaryIds.get(101));
    }

    @Test
    public void changedDictionaryIsPublishedOnTheNextStroke() throws Exception {
        infer("model", "dictionary", true);
        provider.version = "updated";
        provider.source = "new words";
        now = InferenceSession.DICTIONARY_REFRESH_MILLIS;
        infer("model", "dictionary", true);
        assertEquals("old words", sources.get(1));
        refreshes.remove().run();
        infer("model", "dictionary", true);
        assertEquals("new words", sources.get(2));
        assertNotEquals(dictionaryIds.get(0), dictionaryIds.get(2));
        assertEquals(2, provider.reads);
    }

    @Test
    public void invalidationRejectsOutstandingRefreshAndReloadsSameMetadata() throws Exception {
        infer("model", "dictionary", true);
        now = InferenceSession.DICTIONARY_REFRESH_MILLIS;
        infer("model", "dictionary", true);
        session.invalidateDictionary();
        provider.source = "reselected words";
        infer("model", "dictionary", true);
        String selectedId = dictionaryIds.get(2);
        assertNotEquals(dictionaryIds.get(0), selectedId);
        provider.version = "late result";
        provider.source = "stale words";
        refreshes.remove().run();
        infer("model", "dictionary", true);
        assertEquals(selectedId, dictionaryIds.get(3));
        assertEquals("reselected words", sources.get(3));
    }

    @Test
    public void modelSwitchesReopenButWarmupDoesNotAccessDictionary() throws Exception {
        infer("first", "unavailable", false);
        infer("first", "unavailable", false);
        assertEquals(0, provider.queries);
        assertEquals(0, provider.reads);
        assertEquals("__unchanged__", dictionaryIds.get(0));
        infer("second", "", true);
        infer("first", "", true);
        assertEquals(3, provider.opens);
        assertEquals("", dictionaryIds.get(2));
        assertEquals(0, provider.queries);
    }

    @Test
    public void failedModelSwitchDoesNotLeaveJavaAndNativeCachesOutOfSync() throws Exception {
        infer("first", "", false);
        failInference = true;
        assertThrows(IOException.class, () -> infer("second", "", false));
        failInference = false;
        infer("first", "", false);
        assertEquals(3, provider.opens);
        assertNotEquals(Integer.valueOf(-1), descriptors.get(2));
    }

    @Test
    public void refreshFailureIsReportedAndRetriedWithoutBreakingCompositionalInput() throws Exception {
        infer("model", "dictionary", true);
        provider.version = "updated";
        provider.failRead = true;
        now = InferenceSession.DICTIONARY_REFRESH_MILLIS;
        infer("model", "dictionary", true);
        refreshes.remove().run();
        assertThrows(IOException.class, () -> infer("model", "dictionary", true));
        infer("model", "dictionary", false);
        provider.failRead = false;
        now += InferenceSession.DICTIONARY_REFRESH_MILLIS;
        assertThrows(IOException.class, () -> infer("model", "dictionary", true));
        refreshes.remove().run();
        infer("model", "dictionary", true);
        assertNotEquals(dictionaryIds.get(0), dictionaryIds.get(dictionaryIds.size() - 1));
    }

    @Test
    public void changedSelectionSupersedesQueuedRefresh() throws Exception {
        infer("model", "old-dictionary", true);
        now = InferenceSession.DICTIONARY_REFRESH_MILLIS;
        infer("model", "old-dictionary", true);
        provider.source = "selected words";
        infer("model", "new-dictionary", true);
        String selectedId = dictionaryIds.get(2);
        provider.version = "late version";
        provider.source = "late words";
        refreshes.remove().run();
        infer("model", "new-dictionary", true);
        assertEquals(selectedId, dictionaryIds.get(3));
        assertEquals("selected words", sources.get(3));
        infer("model", "", true);
        assertEquals("", dictionaryIds.get(4));
        assertEquals("", sources.get(4));
    }

    @Test
    public void failedInitialDictionaryLoadCanBeRetried() throws Exception {
        provider.failRead = true;
        assertThrows(IOException.class, () -> infer("model", "dictionary", true));
        assertEquals(0, provider.opens);
        provider.failRead = false;
        infer("model", "dictionary", true);
        assertEquals("old words", sources.get(0));
        assertEquals(2, provider.reads);
    }

    private static final class Provider implements InferenceSession.Resources {
        int opens;
        int queries;
        int reads;
        String version = "original";
        String source = "old words";
        boolean failRead;

        public int openModel(String uri) {
            return ++opens;
        }

        public String dictionaryVersion(String uri) {
            queries++;
            return version;
        }

        public String readDictionary(String uri) throws IOException {
            reads++;
            if (failRead) throw new IOException("provider unavailable");
            return source;
        }
    }
}
