package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.util.Log;

import com.google.ai.edge.litertlm.Backend;
import com.google.ai.edge.litertlm.Conversation;
import com.google.ai.edge.litertlm.ConversationConfig;
import com.google.ai.edge.litertlm.Engine;
import com.google.ai.edge.litertlm.EngineConfig;
import com.google.ai.edge.litertlm.Message;
import com.google.ai.edge.litertlm.SamplerConfig;
import com.google.ai.edge.litertlm.ThinkingConfig;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/** Android-owned, process-local LiteRT-LM reranking. No model call crosses JNI. */
final class AndroidCandidateReranker {
    private static final String LOG_TAG = "V7Reranker";
    private static final Object ENGINE_LOCK = new Object();
    private static final int MAX_CONTEXT_TOKENS = 8192;
    private static final int MAX_OUTPUT_TOKENS = 64;
    private static final int CPU_THREADS = RerankerExecutionPolicy.cpuThreadCount(
            Runtime.getRuntime().availableProcessors()
    );
    private static final AtomicLong CANCELLATION_GENERATION = new AtomicLong();

    private static Engine engine;
    private static volatile Conversation activeConversation;
    private static String loadedModelId = "";
    private static volatile String loadedBackend = "";
    private static volatile String state = "disabled";
    private static volatile String lastError = "";

    private AndroidCandidateReranker() {
    }

    static String rerankIfEnabled(Context context, String responseBody) throws Exception {
        if (!ImePreferences.isExperimentalRerankerEnabled(context)
                || !RerankerModelStore.hasModel(context)) {
            releaseIfUnavailable(context);
            return responseBody;
        }

        JSONObject response = new JSONObject(responseBody);
        JSONArray candidates = response.optJSONArray("candidates");
        if (candidates == null || candidates.length() < 2) {
            return responseBody;
        }

        int rerankCount = Math.min(CandidateRerankProtocol.CANDIDATE_LIMIT, candidates.length());
        List<String> candidateTexts = new ArrayList<>(rerankCount);
        for (int index = 0; index < rerankCount; index++) {
            JSONArray parts = candidates.optJSONArray(index);
            if (parts == null) {
                return responseBody;
            }
            StringBuilder text = new StringBuilder();
            for (int partIndex = 0; partIndex < parts.length(); partIndex++) {
                Object part = parts.opt(partIndex);
                if (!(part instanceof String)) {
                    return responseBody;
                }
                text.append((String) part);
            }
            candidateTexts.add(text.toString());
        }

        String modelOutput;
        synchronized (ENGINE_LOCK) {
            Engine current = getOrLoadEngine(context);
            state = "ranking";
            long cancellationGeneration = CANCELLATION_GENERATION.get();
            ConversationConfig config = new ConversationConfig(
                    null,
                    Collections.emptyList(),
                    Collections.emptyList(),
                    new SamplerConfig(1, 1.0, 0.0, 0),
                    false,
                    Collections.emptyList(),
                    Collections.emptyMap(),
                    null,
                    false,
                    MAX_OUTPUT_TOKENS,
                    new ThinkingConfig(false, 0),
                    false
            );
            try {
                try (Conversation conversation = current.createConversation(config)) {
                    activeConversation = conversation;
                    try {
                        Message answer = conversation.sendMessage(
                                CandidateRerankProtocol.buildPrompt(candidateTexts)
                        );
                        modelOutput = answer.toString();
                    } finally {
                        if (activeConversation == conversation) {
                            activeConversation = null;
                        }
                    }
                }
            } catch (Exception | LinkageError error) {
                if (cancellationGeneration != CANCELLATION_GENERATION.get()) {
                    state = "ready";
                    lastError = "";
                    return responseBody;
                }
                setFailure(error);
                closeEngine();
                throw error;
            }
        }

        List<Integer> order = CandidateRerankProtocol.parseOrder(modelOutput, rerankCount);
        List<Object> originalCandidates = new ArrayList<>(candidates.length());
        for (int index = 0; index < candidates.length(); index++) {
            originalCandidates.add(candidates.get(index));
        }
        JSONArray reordered = new JSONArray();
        for (Object candidate : CandidateRerankProtocol.reorderFirstCandidates(
                originalCandidates,
                order
        )) {
            reordered.put(candidate);
        }
        response.put("candidates", reordered);
        state = "ready";
        lastError = "";
        return response.toString();
    }

    private static Engine getOrLoadEngine(Context context) throws Exception {
        String modelId = ImePreferences.getRerankerModelId(context);
        File model = RerankerModelStore.getModelFile(context);
        if (modelId.isEmpty() || !model.isFile()) {
            throw new IllegalStateException("Choose a LiteRT-LM reranker model in Settings");
        }
        if (engine != null && modelId.equals(loadedModelId)) {
            return engine;
        }
        closeEngine();
        state = "loading";
        lastError = "";
        Engine replacement;
        try {
            replacement = initializeEngine(context, model, new Backend.GPU(), "gpu");
        } catch (Exception | LinkageError gpuError) {
            Log.w(
                    LOG_TAG,
                    "LiteRT-LM GPU unavailable; falling back to CPU",
                    gpuError
            );
            try {
                replacement = initializeEngine(
                        context,
                        model,
                        new Backend.CPU(CPU_THREADS, null),
                        "cpu"
                );
            } catch (Exception | LinkageError cpuError) {
                cpuError.addSuppressed(gpuError);
                setFailure(cpuError);
                throw cpuError;
            }
        }
        engine = replacement;
        loadedModelId = modelId;
        return replacement;
    }

    private static Engine initializeEngine(
            Context context,
            File model,
            Backend backend,
            String backendName) throws Exception {
        EngineConfig config = new EngineConfig(
                model.getAbsolutePath(),
                backend,
                null,
                null,
                MAX_CONTEXT_TOKENS,
                null,
                context.getCacheDir().getAbsolutePath()
        );
        Engine replacement = new Engine(config);
        try {
            replacement.initialize();
        } catch (Exception | LinkageError error) {
            replacement.close();
            throw error;
        }
        loadedBackend = backendName;
        return replacement;
    }

    static void releaseIfUnavailable(Context context) {
        if (ImePreferences.isExperimentalRerankerEnabled(context)
                && RerankerModelStore.hasModel(context)) {
            return;
        }
        cancelActiveRanking();
        synchronized (ENGINE_LOCK) {
            closeEngine();
            state = ImePreferences.isExperimentalRerankerEnabled(context)
                    ? "missing"
                    : "disabled";
            lastError = "";
        }
    }

    static String getState(Context context) {
        if (!ImePreferences.isExperimentalRerankerEnabled(context)) {
            return "disabled";
        }
        if (!RerankerModelStore.hasModel(context)) {
            return "missing";
        }
        return state.equals("disabled") ? "not_loaded" : state;
    }

    static String getLastError() {
        return lastError;
    }

    static String getBackend() {
        return loadedBackend;
    }

    static void recordFailure(Throwable error) {
        synchronized (ENGINE_LOCK) {
            setFailure(error);
            closeEngine();
        }
    }

    static void cancelActiveRanking() {
        Conversation active = activeConversation;
        if (active == null) {
            return;
        }
        CANCELLATION_GENERATION.incrementAndGet();
        try {
            active.cancelProcess();
        } catch (Exception | LinkageError ignored) {
            // The running request remains fail-open if cancellation races close.
        }
    }

    private static void setFailure(Throwable error) {
        state = "error";
        String message = error.getMessage();
        lastError = message == null || message.isEmpty()
                ? error.getClass().getSimpleName()
                : message;
    }

    private static void closeEngine() {
        if (engine != null) {
            engine.close();
            engine = null;
        }
        loadedModelId = "";
        loadedBackend = "";
    }
}
