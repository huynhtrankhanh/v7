package com.huynhtrankhanh.v7ime;

import android.content.Context;

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

/** Android-owned, process-local LiteRT-LM reranking. No model call crosses JNI. */
final class AndroidCandidateReranker {
    private static final Object ENGINE_LOCK = new Object();
    private static final int MAX_CONTEXT_TOKENS = 8192;
    private static final int MAX_OUTPUT_TOKENS = 256;

    private static Engine engine;
    private static String loadedModelId = "";

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
                    Message answer = conversation.sendMessage(
                            CandidateRerankProtocol.buildPrompt(candidateTexts)
                    );
                    modelOutput = answer.toString();
                }
            } catch (Exception | LinkageError error) {
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
        EngineConfig config = new EngineConfig(
                model.getAbsolutePath(),
                new Backend.CPU(null, null),
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
        engine = replacement;
        loadedModelId = modelId;
        return replacement;
    }

    static void releaseIfUnavailable(Context context) {
        if (ImePreferences.isExperimentalRerankerEnabled(context)
                && RerankerModelStore.hasModel(context)) {
            return;
        }
        synchronized (ENGINE_LOCK) {
            closeEngine();
        }
    }

    private static void closeEngine() {
        if (engine != null) {
            engine.close();
            engine = null;
        }
        loadedModelId = "";
    }
}
