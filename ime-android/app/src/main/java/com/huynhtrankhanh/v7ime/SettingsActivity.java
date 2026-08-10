package com.huynhtrankhanh.v7ime;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SettingsActivity extends Activity {
    private static final int CHOOSE_MODEL_REQUEST = 1;
    private static final int SAVE_SOURCE_REQUEST = 2;
    private static final int SAVE_APP_DATA_REQUEST = 3;
    private static final int CHOOSE_APP_DATA_REQUEST = 4;
    private static final int CHOOSE_DICTIONARY_MODE_REQUEST = 5;
    private TextView modelStatus;
    private TextView dictionaryModeStatus;
    private Button exportAppData;
    private Button importAppData;
    private static final ExecutorService IO_EXECUTOR =
            Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);
        setTitle(R.string.settings_title);

        modelStatus = findViewById(R.id.model_status);
        dictionaryModeStatus = findViewById(R.id.dictionary_mode_status);
        Button chooseModel = findViewById(R.id.choose_model);
        Button chooseDictionaryMode = findViewById(R.id.choose_dictionary_mode);
        Button manageDictionaries = findViewById(R.id.manage_dictionaries);
        exportAppData = findViewById(R.id.export_app_data);
        importAppData = findViewById(R.id.import_app_data);
        Button saveSource = findViewById(R.id.save_source);
        Button enable = findViewById(R.id.enable_keyboard);
        Button choose = findViewById(R.id.choose_keyboard);

        updateModelStatus();
        updateDictionaryModeStatus();
        chooseModel.setOnClickListener(view -> chooseModel());
        chooseDictionaryMode.setOnClickListener(view -> chooseDictionaryMode());
        manageDictionaries.setOnClickListener(view -> startActivity(
                new Intent(this, DictionaryManagementActivity.class)
        ));
        exportAppData.setOnClickListener(view -> chooseAppDataDestination());
        importAppData.setOnClickListener(view -> chooseAppDataSource());
        saveSource.setOnClickListener(view -> chooseSourceDestination());
        enable.setOnClickListener(view -> startActivity(
                new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)
        ));
        choose.setOnClickListener(view -> {
            InputMethodManager manager = (InputMethodManager)
                    getSystemService(INPUT_METHOD_SERVICE);
            if (manager != null) {
                manager.showInputMethodPicker();
            }
        });
    }

    private void chooseModel() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                )
                .setType("application/octet-stream");
        startActivityForResult(intent, CHOOSE_MODEL_REQUEST);
    }

    private void chooseDictionaryMode() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                )
                .setType("text/plain");
        startActivityForResult(intent, CHOOSE_DICTIONARY_MODE_REQUEST);
    }

    private void chooseSourceDestination() {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/zip")
                .putExtra(Intent.EXTRA_TITLE, "v7-ime-source.zip");
        startActivityForResult(intent, SAVE_SOURCE_REQUEST);
    }

    private void chooseAppDataDestination() {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/vnd.sqlite3")
                .putExtra(Intent.EXTRA_TITLE, "v7-ime-app-data.sqlite3");
        startActivityForResult(intent, SAVE_APP_DATA_REQUEST);
    }

    private void chooseAppDataSource() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*");
        startActivityForResult(intent, CHOOSE_APP_DATA_REQUEST);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            return;
        }
        Uri uri = data.getData();
        if (requestCode == CHOOSE_MODEL_REQUEST) {
            try {
                getContentResolver().takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                );
                ImePreferences.setModelUri(this, uri);
                updateModelStatus();
                Toast.makeText(this, R.string.model_selected, Toast.LENGTH_SHORT).show();
            } catch (SecurityException error) {
                Toast.makeText(this, R.string.model_permission_failed, Toast.LENGTH_LONG)
                        .show();
            }

        } else if (requestCode == CHOOSE_DICTIONARY_MODE_REQUEST) {
            try {
                getContentResolver().takePersistableUriPermission(
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                );
                ImePreferences.setDictionaryModeUri(this, uri);
                updateDictionaryModeStatus();
                Toast.makeText(
                        this,
                        R.string.dictionary_mode_selected,
                        Toast.LENGTH_SHORT
                ).show();
            } catch (SecurityException error) {
                Toast.makeText(this, R.string.model_permission_failed, Toast.LENGTH_LONG)
                        .show();
            }
        } else if (requestCode == SAVE_SOURCE_REQUEST) {
            saveSourceArchive(uri);
        } else if (requestCode == SAVE_APP_DATA_REQUEST) {
            exportAppData(uri);
        } else if (requestCode == CHOOSE_APP_DATA_REQUEST) {
            new AlertDialog.Builder(this)
                    .setTitle(R.string.import_app_data_title)
                    .setMessage(R.string.import_app_data_warning)
                    .setNegativeButton(R.string.cancel, null)
                    .setPositiveButton(
                            R.string.replace_app_data,
                            (dialog, which) -> importAppData(uri)
                    )
                    .show();
        }
    }

    private void updateModelStatus() {
        Uri uri = ImePreferences.getModelUri(this);
        if (uri == null) {
            modelStatus.setText(R.string.no_model_selected);
            return;
        }
        String name = null;
        Long size = null;
        try (Cursor cursor = getContentResolver().query(
                uri,
                new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE},
                null,
                null,
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIndex >= 0) {
                    name = cursor.getString(nameIndex);
                }
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                    size = cursor.getLong(sizeIndex);
                }
            }
        } catch (Exception ignored) {
            // The persisted provider may currently be offline.
        }
        if (TextUtils.isEmpty(name)) {
            name = uri.getLastPathSegment();
        }
        String detail = size == null
                ? name
                : getString(R.string.model_status_with_size, name, formatBytes(size));
        modelStatus.setText(detail);
    }

    private void updateDictionaryModeStatus() {
        Uri uri = ImePreferences.getDictionaryModeUri(this);
        if (uri == null) {
            dictionaryModeStatus.setText(R.string.dictionary_mode_bundled);
            return;
        }
        String name = null;
        try (Cursor cursor = getContentResolver().query(
                uri,
                new String[]{OpenableColumns.DISPLAY_NAME},
                null,
                null,
                null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) name = cursor.getString(index);
            }
        } catch (Exception ignored) {
            // The persisted provider may currently be offline.
        }
        dictionaryModeStatus.setText(
                TextUtils.isEmpty(name) ? uri.getLastPathSegment() : name
        );
    }

    private String formatBytes(long bytes) {
        if (bytes >= 1024L * 1024L) {
            return String.format(
                    Locale.ROOT,
                    "%.1f MiB",
                    bytes / (1024.0 * 1024.0)
            );
        }
        if (bytes >= 1024L) {
            return String.format(Locale.ROOT, "%.1f KiB", bytes / 1024.0);
        }
        return bytes + " B";
    }

    private void saveSourceArchive(Uri destination) {
        try (InputStream input = getAssets().open("v7-ime-source.zip");
             OutputStream output = getContentResolver().openOutputStream(destination)) {
            if (output == null) {
                throw new IOException("Destination is unavailable");
            }
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            Toast.makeText(this, R.string.source_saved, Toast.LENGTH_LONG).show();
        } catch (IOException error) {
            Toast.makeText(
                    this,
                    getString(R.string.source_save_failed, error.getMessage()),
                    Toast.LENGTH_LONG
            ).show();
        }
    }

    private void exportAppData(Uri destination) {
        setDataTransferBusy(true);
        BundledStrippedPloverRuntime.get(this).pauseForDataTransfer(transferError -> {
            if (!transferError.isEmpty()) {
                finishDataTransfer(false, false, transferError);
                return;
            }
            IO_EXECUTOR.execute(() -> {
                String failure = "";
                try {
                    AppDataTransfer.exportDatabase(this, destination);
                } catch (IOException exportError) {
                    failure = messageFor(exportError);
                } finally {
                    BundledStrippedPloverRuntime.get(this)
                            .resumeAfterDataTransfer();
                }
                String finalFailure = failure;
                runOnUiThread(() -> finishDataTransfer(
                        false,
                        finalFailure.isEmpty(),
                        finalFailure
                ));
            });
        });
    }

    private void importAppData(Uri source) {
        setDataTransferBusy(true);
        IO_EXECUTOR.execute(() -> {
            File staged;
            try {
                staged = AppDataTransfer.stageImport(this, source);
            } catch (IOException error) {
                String failure = messageFor(error);
                runOnUiThread(() -> finishDataTransfer(true, false, failure));
                return;
            }
            runOnUiThread(() -> BundledStrippedPloverRuntime.get(this)
                    .pauseForDataTransfer(error -> {
                        if (!error.isEmpty()) {
                            AppDataTransfer.deleteQuietly(staged);
                            finishDataTransfer(true, false, error);
                            return;
                        }
                        IO_EXECUTOR.execute(() -> {
                            String failure = "";
                            try {
                                AppDataTransfer.installStagedDatabase(
                                        this,
                                        staged
                                );
                            } catch (IOException installError) {
                                failure = messageFor(installError);
                            } finally {
                                AppDataTransfer.deleteQuietly(staged);
                                BundledStrippedPloverRuntime.get(this)
                                        .resumeAfterDataTransfer();
                            }
                            String finalFailure = failure;
                            runOnUiThread(() -> finishDataTransfer(
                                    true,
                                    finalFailure.isEmpty(),
                                    finalFailure
                            ));
                        });
                    }));
        });
    }

    private void setDataTransferBusy(boolean busy) {
        exportAppData.setEnabled(!busy);
        importAppData.setEnabled(!busy);
    }

    private void finishDataTransfer(
            boolean importing,
            boolean success,
            String error) {
        setDataTransferBusy(false);
        int message;
        if (success) {
            message = importing
                    ? R.string.app_data_imported
                    : R.string.app_data_exported;
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            return;
        }
        String failure = getString(
                importing
                        ? R.string.app_data_import_failed
                        : R.string.app_data_export_failed,
                error
        );
        Toast.makeText(this, failure, Toast.LENGTH_LONG).show();
    }

    private static String messageFor(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty()
                ? error.getClass().getSimpleName()
                : message;
    }
}
