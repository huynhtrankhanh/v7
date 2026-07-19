package com.huynhtrankhanh.v7ime;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

public class SettingsActivity extends Activity {
    private static final int CHOOSE_MODEL_REQUEST = 1;
    private static final int SAVE_SOURCE_REQUEST = 2;

    private EditText ploverHost;
    private EditText ploverPort;
    private TextView modelStatus;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);
        setTitle(R.string.settings_title);

        ploverHost = findViewById(R.id.plover_host);
        ploverPort = findViewById(R.id.plover_port);
        modelStatus = findViewById(R.id.model_status);
        Button chooseModel = findViewById(R.id.choose_model);
        Button save = findViewById(R.id.save_settings);
        Button saveSource = findViewById(R.id.save_source);
        Button enable = findViewById(R.id.enable_keyboard);
        Button choose = findViewById(R.id.choose_keyboard);

        ploverHost.setText(ImePreferences.getPloverHost(this));
        ploverPort.setText(String.valueOf(ImePreferences.getPloverPort(this)));
        updateModelStatus();

        chooseModel.setOnClickListener(view -> chooseModel());
        save.setOnClickListener(view -> saveSettings());
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

    private void chooseSourceDestination() {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/zip")
                .putExtra(Intent.EXTRA_TITLE, "v7-ime-source.zip");
        startActivityForResult(intent, SAVE_SOURCE_REQUEST);
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
        } else if (requestCode == SAVE_SOURCE_REQUEST) {
            saveSourceArchive(uri);
        }
    }

    private void saveSettings() {
        String host = ploverHost.getText().toString().trim();
        String portText = ploverPort.getText().toString().trim();
        int port;
        try {
            port = Integer.parseInt(portText);
        } catch (NumberFormatException error) {
            port = -1;
        }
        if (port < 1 || port > 65535) {
            ploverPort.setError(getString(R.string.invalid_plover_port));
            ploverPort.requestFocus();
            return;
        }
        if (host.contains("://") || host.contains("/") || host.contains(" ")) {
            ploverHost.setError(getString(R.string.invalid_plover_host));
            ploverHost.requestFocus();
            return;
        }
        ImePreferences.savePlover(this, host, port);
        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show();
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
}
