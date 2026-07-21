package com.huynhtrankhanh.v7ime;

import android.content.Context;

import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

final class DictionaryImportManager {
    static final String INPUT_TASK_ID = "task_id";
    static final String INPUT_NAME = "name";
    static final String INPUT_TYPE = "type";
    static final String INPUT_MERGE = "merge";
    static final String INPUT_SOURCE_PATH = "source_path";

    private static final String WORK_NAME = "stripped-plover-imports";
    private static final String PREFERENCES = "dictionary_imports";
    private static final String LATEST_TASK = "latest_task";
    private static final String STATE_PREFIX = "state.";

    private DictionaryImportManager() {
    }

    static String enqueue(
            Context context,
            String name,
            String type,
            String source,
            boolean merge) throws IOException {
        Context application = context.getApplicationContext();
        String taskId = UUID.randomUUID().toString();
        File directory = new File(application.getFilesDir(), "dictionary-imports");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("Could not create the import staging directory");
        }
        File sourceFile = new File(directory, taskId + ".source");
        try (FileOutputStream output = new FileOutputStream(sourceFile, false)) {
            output.write(source.getBytes(StandardCharsets.UTF_8));
        }

        updateState(application, taskId, name, "queued", "Waiting to start");
        Data input = new Data.Builder()
                .putString(INPUT_TASK_ID, taskId)
                .putString(INPUT_NAME, name)
                .putString(INPUT_TYPE, type)
                .putBoolean(INPUT_MERGE, merge)
                .putString(INPUT_SOURCE_PATH, sourceFile.getPath())
                .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(
                DictionaryImportWorker.class
        ).setInputData(input).build();
        try {
            WorkManager.getInstance(application).beginUniqueWork(
                    WORK_NAME,
                    ExistingWorkPolicy.APPEND_OR_REPLACE,
                    request
            ).enqueue();
        } catch (RuntimeException error) {
            AppDataTransfer.deleteQuietly(sourceFile);
            updateState(
                    application,
                    taskId,
                    name,
                    "failed",
                    messageFor(error)
            );
            throw new IOException("Could not schedule the dictionary import", error);
        }
        return taskId;
    }

    static String getState(Context context, String requestedTaskId) {
        String taskId = requestedTaskId == null || requestedTaskId.isEmpty()
                ? preferences(context).getString(LATEST_TASK, "")
                : requestedTaskId;
        if (taskId == null || taskId.isEmpty()) {
            return "";
        }
        return preferences(context).getString(STATE_PREFIX + taskId, "");
    }

    static void updateState(
            Context context,
            String taskId,
            String name,
            String status,
            String message) {
        try {
            String state = new JSONObject()
                    .put("id", taskId)
                    .put("name", name)
                    .put("status", status)
                    .put("message", message == null ? "" : message)
                    .toString();
            preferences(context).edit()
                    .putString(LATEST_TASK, taskId)
                    .putString(STATE_PREFIX + taskId, state)
                    .apply();
        } catch (JSONException impossible) {
            throw new IllegalStateException("Could not encode import state", impossible);
        }
    }

    static String messageFor(Throwable error) {
        String message = error.getMessage();
        return message == null || message.isEmpty()
                ? error.getClass().getSimpleName()
                : message;
    }

    private static android.content.SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(
                PREFERENCES,
                Context.MODE_PRIVATE
        );
    }
}
