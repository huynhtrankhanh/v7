package com.huynhtrankhanh.v7ime;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class DictionaryImportWorker extends Worker {
    private static final String CHANNEL_ID = "dictionary-imports";
    private static final long IMPORT_TIMEOUT_MINUTES = 4;

    public DictionaryImportWorker(
            @NonNull Context context,
            @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull
    @Override
    public Result doWork() {
        String taskId = value(DictionaryImportManager.INPUT_TASK_ID);
        String name = value(DictionaryImportManager.INPUT_NAME);
        String type = value(DictionaryImportManager.INPUT_TYPE);
        File sourceFile = new File(value(DictionaryImportManager.INPUT_SOURCE_PATH));
        try {
            setForegroundAsync(createForegroundInfo(name)).get();
            DictionaryImportManager.updateState(
                    getApplicationContext(),
                    taskId,
                    name,
                    "running",
                    "Loading in the Stripped Plover sandbox"
            );
            String source = readSource(sourceFile);
            JSONObject params = new JSONObject()
                    .put("name", name)
                    .put("type", type)
                    .put(
                            "merge",
                            getInputData().getBoolean(
                                    DictionaryImportManager.INPUT_MERGE,
                                    false
                            )
                    )
                    .put("source", source);
            JSONObject request = new JSONObject()
                    .put("id", taskId)
                    .put("method", "import_dictionary_source")
                    .put("params", params);

            CountDownLatch completion = new CountDownLatch(1);
            AtomicReference<String> response = new AtomicReference<>("");
            AtomicReference<String> runtimeError = new AtomicReference<>("");
            BundledStrippedPloverRuntime.get(getApplicationContext()).request(
                    request.toString(),
                    (body, error) -> {
                        response.set(body);
                        runtimeError.set(error);
                        completion.countDown();
                    }
            );
            if (!completion.await(IMPORT_TIMEOUT_MINUTES, TimeUnit.MINUTES)) {
                throw new IllegalStateException("Dictionary import timed out");
            }
            if (!runtimeError.get().isEmpty()) {
                throw new IllegalStateException(runtimeError.get());
            }
            JSONObject envelope = new JSONObject(response.get());
            JSONObject protocolError = envelope.optJSONObject("error");
            if (protocolError != null) {
                throw new IllegalStateException(
                        protocolError.optString("message", "Dictionary import failed")
                );
            }
            JSONObject result = envelope.optJSONObject("result");
            if (result == null || !"ok".equals(result.optString("status"))) {
                throw new IllegalStateException("Stripped Plover rejected the import");
            }
            int entries = result.optInt("entries", -1);
            String message = entries < 0
                    ? "Import complete"
                    : "Imported " + entries + " entries";
            DictionaryImportManager.updateState(
                    getApplicationContext(),
                    taskId,
                    name,
                    "succeeded",
                    message
            );
            return Result.success();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return fail(taskId, name, "Dictionary import was interrupted");
        } catch (Exception error) {
            return fail(
                    taskId,
                    name,
                    DictionaryImportManager.messageFor(error)
            );
        } finally {
            AppDataTransfer.deleteQuietly(sourceFile);
        }
    }

    private Result fail(String taskId, String name, String message) {
        DictionaryImportManager.updateState(
                getApplicationContext(),
                taskId,
                name,
                "failed",
                message
        );
        return Result.failure();
    }

    private ForegroundInfo createForegroundInfo(String name) {
        Context context = getApplicationContext();
        NotificationManager manager = (NotificationManager)
                context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(new NotificationChannel(
                    CHANNEL_ID,
                    context.getString(R.string.dictionary_import_channel),
                    NotificationManager.IMPORTANCE_LOW
            ));
        }
        Notification notification = new NotificationCompat.Builder(
                context,
                CHANNEL_ID
        )
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(
                        context.getString(
                                R.string.dictionary_import_notification_title
                        )
                )
                .setContentText(
                        context.getString(
                                R.string.dictionary_import_notification_text,
                                name
                        )
                )
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setProgress(0, 0, true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
        int notificationId = 2000 + Math.abs(getId().hashCode() % 10000);
        return new ForegroundInfo(
                notificationId,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        );
    }

    private static String readSource(File sourceFile) throws IOException {
        try (FileInputStream input = new FileInputStream(sourceFile);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private String value(String key) {
        String result = getInputData().getString(key);
        return result == null ? "" : result;
    }
}
