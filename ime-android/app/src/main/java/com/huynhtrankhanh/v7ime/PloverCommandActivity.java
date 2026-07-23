package com.huynhtrankhanh.v7ime;

import android.app.Activity;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

public class PloverCommandActivity extends Activity {
    static final String ACTION_LOOKUP =
            "com.huynhtrankhanh.v7ime.action.PLOVER_LOOKUP";
    static final String ACTION_ADD_TRANSLATION =
            "com.huynhtrankhanh.v7ime.action.PLOVER_ADD_TRANSLATION";
    static final String EXTRA_ARGUMENT = "plover_argument";
    static final String RAW_OUTLINE_IME_OPTION =
            "com.huynhtrankhanh.v7ime.RAW_OUTLINE";

    private final AtomicInteger requestIds = new AtomicInteger(1);
    private LinearLayout content;
    private FrameLayout rootView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(16), dp(20), dp(16));

        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.addView(content, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));
        rootView = new FrameLayout(this);
        rootView.addView(scrollView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(rootView);
        BundledStrippedPloverRuntime.get(this).attachTo(rootView);

        String action = getIntent().getAction();
        String argument = getIntent().getStringExtra(EXTRA_ARGUMENT);
        if (ACTION_ADD_TRANSLATION.equals(action)) {
            setTitle(R.string.add_translation_title);
            showAddTranslation(argument == null ? "" : argument);
        } else {
            setTitle(R.string.lookup_entries_title);
            showLookup(argument == null ? "" : argument);
        }
    }

    @Override
    protected void onDestroy() {
        if (rootView != null) {
            BundledStrippedPloverRuntime.get(this).detachFrom(rootView);
            rootView = null;
        }
        super.onDestroy();
    }

    private void showLookup(String argument) {
        addDescription(R.string.lookup_entries_description);
        EditText stroke = addField(
                R.string.stroke_label,
                R.string.stroke_hint,
                InputType.TYPE_CLASS_TEXT
                        | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        );
        EditText translation = addField(
                R.string.translation_label,
                R.string.translation_hint,
                InputType.TYPE_CLASS_TEXT
                        | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        );
        if (looksLikeOutline(argument)) {
            stroke.setText(argument);
        } else {
            translation.setText(argument);
        }

        TextView status = addStatus();
        Button lookup = addButton(R.string.lookup_action);
        lookup.setOnClickListener(view -> {
            String strokeQuery = stroke.getText().toString().trim();
            String translationQuery = translation.getText().toString().trim();
            if (strokeQuery.isEmpty() && translationQuery.isEmpty()) {
                status.setText(R.string.lookup_query_required);
                return;
            }
            lookup.setEnabled(false);
            status.setText(R.string.looking_up_entries);
            JSONObject params = new JSONObject();
            try {
                if (!strokeQuery.isEmpty()) {
                    params.put("stroke", strokeQuery);
                }
                if (!translationQuery.isEmpty()) {
                    params.put("output", translationQuery);
                }
                params.put("match", "substring");
                params.put("sort", "alphabetic");
                params.put("page", 1);
                params.put("page_size", 100);
            } catch (Exception error) {
                status.setText(messageFor(error));
                lookup.setEnabled(true);
                return;
            }
            request("search_entries", params, (result, error) -> {
                lookup.setEnabled(true);
                if (!error.isEmpty()) {
                    status.setText(error);
                    return;
                }
                status.setText(formatLookupResults(
                        result,
                        strokeQuery,
                        translationQuery
                ));
            });
        });
        addCloseButton();
    }

    private void showAddTranslation(String argument) {
        addDescription(R.string.add_translation_description);
        EditText outline = addField(
                R.string.outline_label,
                R.string.outline_hint,
                InputType.TYPE_CLASS_TEXT
                        | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        );
        outline.setPrivateImeOptions(RAW_OUTLINE_IME_OPTION);
        outline.setImeOptions(EditorInfo.IME_ACTION_NEXT);

        EditText translation = addField(
                R.string.translation_label,
                R.string.translation_hint,
                InputType.TYPE_CLASS_TEXT
                        | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                        | InputType.TYPE_TEXT_FLAG_MULTI_LINE
        );
        translation.setMinLines(2);
        translation.setGravity(Gravity.TOP | Gravity.START);
        if (!argument.trim().isEmpty()) {
            translation.setText(argument.trim());
        }

        TextView dictionaryLabel = addLabel(R.string.dictionary_label);
        Spinner dictionaries = new Spinner(this);
        content.addView(dictionaries, matchWrap());
        TextView status = addStatus();
        Button add = addButton(R.string.add_translation_action);
        add.setEnabled(false);
        addCloseButton();

        List<String> writableDictionaries = new ArrayList<>();
        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                this,
                android.R.layout.simple_spinner_dropdown_item,
                writableDictionaries
        );
        dictionaries.setAdapter(adapter);
        status.setText(R.string.loading_dictionaries);
        request("get_dictionary_state", new JSONObject(), (result, error) -> {
            if (!error.isEmpty()) {
                status.setText(error);
                return;
            }
            JSONArray state = result.optJSONArray("dictionaries");
            for (int index = 0; state != null && index < state.length(); index++) {
                JSONObject dictionary = state.optJSONObject(index);
                if (dictionary != null
                        && !dictionary.optBoolean("readonly", true)) {
                    String identifier = dictionary.optString("identifier", "");
                    if (!identifier.isEmpty()) {
                        writableDictionaries.add(identifier);
                    }
                }
            }
            adapter.notifyDataSetChanged();
            boolean available = !writableDictionaries.isEmpty();
            dictionaries.setEnabled(available);
            dictionaryLabel.setEnabled(available);
            add.setEnabled(available);
            status.setText(
                    available
                            ? R.string.choose_dictionary_and_add
                            : R.string.no_writable_dictionaries
            );
        });

        add.setOnClickListener(view -> {
            String stroke = outline.getText().toString().trim();
            String output = translation.getText().toString();
            if (stroke.isEmpty() || output.isEmpty()) {
                status.setText(R.string.translation_fields_required);
                return;
            }
            Object selected = dictionaries.getSelectedItem();
            if (selected == null) {
                status.setText(R.string.no_writable_dictionaries);
                return;
            }
            add.setEnabled(false);
            status.setText(R.string.adding_translation);
            JSONObject params = new JSONObject();
            try {
                params.put("name", selected.toString());
                params.put("stroke", stroke);
                params.put("translation", output);
            } catch (Exception error) {
                status.setText(messageFor(error));
                add.setEnabled(true);
                return;
            }
            request("add_entry", params, (result, error) -> {
                add.setEnabled(true);
                if (!error.isEmpty()) {
                    status.setText(error);
                    return;
                }
                status.setText(getString(
                        R.string.translation_added,
                        stroke,
                        selected.toString()
                ));
            });
        });
    }

    private String formatLookupResults(
            JSONObject result,
            String strokeQuery,
            String translationQuery) {
        JSONArray entries = result.optJSONArray("entries");
        List<String> rows = new ArrayList<>();
        for (int index = 0; entries != null && index < entries.length(); index++) {
            JSONObject entry = entries.optJSONObject(index);
            if (entry == null) {
                continue;
            }
            String stroke = entry.optString("stroke", "");
            String translation = entry.optString("translation", "");
            if (!strokeQuery.isEmpty()
                    && !stroke.equalsIgnoreCase(strokeQuery)) {
                continue;
            }
            if (!translationQuery.isEmpty()
                    && !translation.toLowerCase(Locale.ROOT).contains(
                            translationQuery.toLowerCase(Locale.ROOT)
                    )) {
                continue;
            }
            String dictionary = entry.optString(
                    "dictionary",
                    getString(R.string.unknown_dictionary)
            );
            rows.add(stroke + " \u2192 " + translation + "\n"
                    + getString(R.string.from_dictionary, dictionary));
        }
        if (rows.isEmpty()) {
            return getString(R.string.no_lookup_results);
        }
        return android.text.TextUtils.join("\n\n", rows);
    }

    private void request(
            String method,
            JSONObject params,
            ResultCallback callback) {
        int id = requestIds.getAndIncrement();
        JSONObject request = new JSONObject();
        try {
            request.put("id", id);
            request.put("method", method);
            request.put("params", params);
        } catch (Exception error) {
            callback.onResult(new JSONObject(), messageFor(error));
            return;
        }
        BundledStrippedPloverRuntime.get(this).request(
                request.toString(),
                (responseBody, transportError) -> runOnUiThread(() -> {
                    if (!transportError.isEmpty()) {
                        callback.onResult(new JSONObject(), transportError);
                        return;
                    }
                    try {
                        JSONObject response = new JSONObject(responseBody);
                        JSONObject protocolError = response.optJSONObject("error");
                        if (protocolError != null) {
                            callback.onResult(
                                    new JSONObject(),
                                    protocolError.optString(
                                            "message",
                                            getString(R.string.plover_request_failed)
                                    )
                            );
                            return;
                        }
                        JSONObject result = response.optJSONObject("result");
                        callback.onResult(
                                result == null ? new JSONObject() : result,
                                ""
                        );
                    } catch (Exception error) {
                        callback.onResult(new JSONObject(), messageFor(error));
                    }
                })
        );
    }

    private void addDescription(int text) {
        TextView description = new TextView(this);
        description.setText(text);
        description.setPadding(0, 0, 0, dp(12));
        content.addView(description, matchWrap());
    }

    private EditText addField(int labelText, int hintText, int inputType) {
        addLabel(labelText);
        EditText field = new EditText(this);
        field.setHint(hintText);
        field.setInputType(inputType);
        content.addView(field, matchWrap());
        return field;
    }

    private TextView addLabel(int text) {
        TextView label = new TextView(this);
        label.setText(text);
        label.setPadding(0, dp(10), 0, 0);
        content.addView(label, matchWrap());
        return label;
    }

    private TextView addStatus() {
        TextView status = new TextView(this);
        status.setPadding(0, dp(14), 0, dp(8));
        status.setTextIsSelectable(true);
        content.addView(status, matchWrap());
        return status;
    }

    private Button addButton(int text) {
        Button button = new Button(this);
        button.setText(text);
        content.addView(button, matchWrap());
        return button;
    }

    private void addCloseButton() {
        Button close = addButton(R.string.close);
        close.setOnClickListener(view -> finish());
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static boolean looksLikeOutline(String value) {
        return value != null
                && !value.isEmpty()
                && value.matches("[#STKPWHRAO*EUFRPBLGTSDZ\\-/]+");
    }

    private static String messageFor(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty()
                ? error.getClass().getSimpleName()
                : message;
    }

    private interface ResultCallback {
        void onResult(JSONObject result, String error);
    }
}
