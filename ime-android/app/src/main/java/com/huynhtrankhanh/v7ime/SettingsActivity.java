package com.huynhtrankhanh.v7ime;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;

public class SettingsActivity extends Activity {
    private EditText serverUrl;
    private EditText username;
    private EditText password;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);
        setTitle(R.string.settings_title);

        serverUrl = findViewById(R.id.server_url);
        username = findViewById(R.id.http_username);
        password = findViewById(R.id.http_password);
        Button save = findViewById(R.id.save_settings);
        Button enable = findViewById(R.id.enable_keyboard);
        Button choose = findViewById(R.id.choose_keyboard);

        serverUrl.setText(ImePreferences.getServerUrl(this));
        username.setText(ImePreferences.getUsername(this));
        password.setText(ImePreferences.getPassword(this));

        save.setOnClickListener(view -> saveSettings());
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

    private void saveSettings() {
        String url = serverUrl.getText().toString().trim();
        Uri parsedUrl = Uri.parse(url);
        boolean validScheme = "http".equalsIgnoreCase(parsedUrl.getScheme())
                || "https".equalsIgnoreCase(parsedUrl.getScheme());
        if (!TextUtils.isEmpty(url)
                && (!validScheme || TextUtils.isEmpty(parsedUrl.getHost()))) {
            serverUrl.setError(getString(R.string.invalid_server_url));
            serverUrl.requestFocus();
            return;
        }

        ImePreferences.save(
                this,
                url,
                username.getText().toString(),
                password.getText().toString()
        );
        Toast.makeText(this, R.string.settings_saved, Toast.LENGTH_SHORT).show();
    }
}
