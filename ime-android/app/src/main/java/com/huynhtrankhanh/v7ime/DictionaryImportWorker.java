package com.huynhtrankhanh.v7ime;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.ServiceInfo;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Data;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public class DictionaryImportWorker extends Worker {
    private static final String CHANNEL_ID = "dictionary-imports";
    private static final long RUNTIME_PAUSE_TIMEOUT_MINUTES = 3;

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
        BundledStrippedPloverRuntime runtime = BundledStrippedPloverRuntime.get(
                getApplicationContext()
        );
        boolean runtimePaused = false;
        try {
            reportProgress(taskId, name, "Preparing import", 0, -1, 2);
            byte[] source = readSource(sourceFile);
            reportProgress(taskId, name, "Waiting for Stripped Plover", 0, -1, 5);
            CountDownLatch completion = new CountDownLatch(1);
            AtomicReference<String> pauseError = new AtomicReference<>("");
            runtime.pauseForDictionaryImport(
                    error -> {
                        pauseError.set(error);
                        completion.countDown();
                    }
            );
            if (!completion.await(
                    RUNTIME_PAUSE_TIMEOUT_MINUTES,
                    TimeUnit.MINUTES
            )) {
                throw new IllegalStateException(
                        "Timed out waiting to pause Stripped Plover"
                );
            }
            if (!pauseError.get().isEmpty()) {
                throw new IllegalStateException(pauseError.get());
            }
            runtimePaused = true;

            SandboxedDictionaryImporter.ImportResult imported =
                    SandboxedDictionaryImporter.importSource(
                            getApplicationContext(),
                            name,
                            type,
                            source,
                            getInputData().getBoolean(
                                    DictionaryImportManager.INPUT_MERGE,
                                    false
                            ),
                            (phase, current, total, percent) -> reportProgress(
                                    taskId,
                                    name,
                                    phase,
                                    current,
                                    total,
                                    percent
                            )
                    );
            reportProgress(
                    taskId,
                    name,
                    "Restarting Stripped Plover",
                    imported.entries < 0 ? 0 : imported.entries,
                    imported.entries,
                    96
            );
            runtime.resumeAfterDataTransfer();
            runtimePaused = false;
            String message = imported.python
                    ? "Installed Python source for CPython/Wasm"
                    : "Imported " + imported.entries + " entries";
            DictionaryImportManager.updateState(
                    getApplicationContext(),
                    taskId,
                    name,
                    "succeeded",
                    message,
                    "Complete",
                    imported.entries < 0 ? 1 : imported.entries,
                    imported.entries < 0 ? 1 : imported.entries,
                    100
            );
            setProgressAsync(new Data.Builder()
                    .putInt("percent", 100)
                    .putString("phase", "Complete")
                    .build()).get();
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
            if (runtimePaused) {
                runtime.resumeAfterDataTransfer();
            }
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

    private void reportProgress(
            String taskId,
            String name,
            String phase,
            int current,
            int total,
            int percent) throws Exception {
        String detail = total >= 0
                ? phase + " (" + current + " / " + total + ")"
                : phase;
        DictionaryImportManager.updateState(
                getApplicationContext(),
                taskId,
                name,
                "running",
                detail,
                phase,
                current,
                total,
                percent
        );
        setProgressAsync(new Data.Builder()
                .putInt("percent", percent)
                .putString("phase", phase)
                .putInt("current", current)
                .putInt("total", total)
                .build()).get();
        setForegroundAsync(createForegroundInfo(name, phase, percent)).get();
    }

    private ForegroundInfo createForegroundInfo(
            String name,
            String phase,
            int percent) {
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
                        name + " · " + phase
                )
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setProgress(100, percent, false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
        int notificationId = 2000 + Math.abs(getId().hashCode() % 10000);
        return new ForegroundInfo(
                notificationId,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        );
    }

    private static byte[] readSource(File sourceFile) throws IOException {
        try (FileInputStream input = new FileInputStream(sourceFile);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private String value(String key) {
        String result = getInputData().getString(key);
        return result == null ? "" : result;
    }
}
