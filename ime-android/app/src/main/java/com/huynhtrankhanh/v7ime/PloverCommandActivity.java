package com.huynhtrankhanh.v7ime;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Bundle;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;

public class PloverCommandActivity extends Activity {
    static final String ACTION_LOOKUP =
            "com.huynhtrankhanh.v7ime.action.PLOVER_LOOKUP";
    static final String ACTION_ADD_TRANSLATION =
            "com.huynhtrankhanh.v7ime.action.PLOVER_ADD_TRANSLATION";
    static final String EXTRA_ARGUMENT = "plover_argument";
    private final AtomicInteger requestIds = new AtomicInteger(1);
    private LinearLayout content;
    private FrameLayout rootView;
    private ScrollView scrollView;
    private final List<View> focusOrder = new ArrayList<>();
    private final List<RadioButton> dictionaryChoices = new ArrayList<>();
    private final List<String> writableDictionaries = new ArrayList<>();
    private RadioGroup dictionaryGroup;
    private int commandGeneration = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PloverCommandFocusState.setNativeControlFocused(false);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(16), dp(20), dp(16));

        scrollView = new ScrollView(this);
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
        setFinishOnTouchOutside(false);
        BundledStrippedPloverRuntime.get(this).attachTo(rootView);

        renderCommand(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        renderCommand(intent);
    }

    @Override
    protected void onPause() {
        PloverCommandFocusState.setNativeControlFocused(false);
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        View focused = getCurrentFocus();
        PloverCommandFocusState.setNativeControlFocused(
                focused != null && !(focused instanceof EditText)
        );
    }

    @Override
    protected void onStart() {
        super.onStart();
        PloverCommandFocusState.setCommandActivityActive(true);
    }

    @Override
    protected void onStop() {
        PloverCommandFocusState.setCommandActivityActive(false);
        super.onStop();
    }

    private void renderCommand(Intent intent) {
        commandGeneration += 1;
        content.removeAllViews();
        focusOrder.clear();
        dictionaryChoices.clear();
        writableDictionaries.clear();
        dictionaryGroup = null;

        String action = intent.getAction();
        String argument = intent.getStringExtra(EXTRA_ARGUMENT);
        if (ACTION_ADD_TRANSLATION.equals(action)) {
            setTitle(R.string.add_translation_title);
            addDialogTitle(R.string.add_translation_title);
            showAddTranslation(argument == null ? "" : argument);
        } else {
            setTitle(R.string.lookup_entries_title);
            addDialogTitle(R.string.lookup_entries_title);
            showLookup(argument == null ? "" : argument);
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_ESCAPE
                && !event.isShiftPressed()
                && !event.isCtrlPressed()
                && !event.isAltPressed()
                && !event.isMetaPressed()) {
            if (event.getAction() == KeyEvent.ACTION_DOWN
                    && event.getRepeatCount() == 0) {
                finish();
            }
            return true;
        }
        if (event.getKeyCode() == KeyEvent.KEYCODE_TAB
                && !event.isCtrlPressed()
                && !event.isAltPressed()
                && !event.isMetaPressed()) {
            if (event.getAction() == KeyEvent.ACTION_DOWN
                    && event.getRepeatCount() == 0) {
                moveFocus(event.isShiftPressed());
            }
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN
                && event.getRepeatCount() == 0
                && selectDictionaryByShortcut(event)) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onDestroy() {
        PloverCommandFocusState.setNativeControlFocused(false);
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
        configureRawOutlineField(stroke);
        EditText translation = addField(
                R.string.translation_label,
                R.string.translation_hint,
                InputType.TYPE_CLASS_TEXT
                        | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        );
        // The pinned protocol has one untyped argument. Preserve it as text:
        // HAT, for example, cannot be classified reliably as either ordinary
        // text or a steno outline without protocol type metadata.
        translation.setText(argument);

        TextView status = addStatus();
        LookupQueryGeneration queryGeneration = new LookupQueryGeneration();
        Button lookupStroke = addButton(R.string.lookup_stroke_action);
        Button lookupTranslation = addButton(R.string.lookup_translation_action);
        TextWatcher invalidateLookup = new TextWatcher() {
            @Override public void beforeTextChanged(
                    CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(
                    CharSequence value, int start, int before, int count) {
                queryGeneration.edited();
                lookupStroke.setEnabled(true);
                lookupTranslation.setEnabled(true);
                clearStatus(status);
            }
            @Override public void afterTextChanged(Editable value) {}
        };
        stroke.addTextChangedListener(invalidateLookup);
        translation.addTextChangedListener(invalidateLookup);
        lookupStroke.setOnClickListener(view -> {
            String query = stroke.getText().toString().trim();
            if (query.isEmpty()) {
                showTerminalStatus(status, R.string.lookup_stroke_required);
                return;
            }
            int generation = queryGeneration.submit();
            lookupStroke.setEnabled(false);
            lookupTranslation.setEnabled(false);
            showProgress(status);
            BooleanSupplier ownsRequest = () -> queryGeneration.owns(generation)
                    && query.equals(stroke.getText().toString().trim());
            searchExactEntries("stroke", query, ownsRequest, (entries, error) -> {
                if (!queryGeneration.owns(generation)
                        || !query.equals(stroke.getText().toString().trim())) {
                    return;
                }
                queryGeneration.completed(generation);
                lookupStroke.setEnabled(true);
                lookupTranslation.setEnabled(true);
                showTerminalStatus(status, error.isEmpty()
                        ? formatEntrySearchResult(entries) : error);
            });
        });
        lookupTranslation.setOnClickListener(view -> {
            String query = translation.getText().toString().trim();
            if (query.isEmpty()) {
                showTerminalStatus(status, R.string.lookup_translation_required);
                return;
            }
            int generation = queryGeneration.submit();
            lookupStroke.setEnabled(false);
            lookupTranslation.setEnabled(false);
            showProgress(status);
            BooleanSupplier ownsRequest = () -> queryGeneration.owns(generation)
                    && query.equals(translation.getText().toString().trim());
            searchUnicodeTranslationEntries(query, ownsRequest, (entries, error) -> {
                if (!queryGeneration.owns(generation)
                        || !query.equals(translation.getText().toString().trim())) {
                    return;
                }
                queryGeneration.completed(generation);
                lookupStroke.setEnabled(true);
                lookupTranslation.setEnabled(true);
                showTerminalStatus(status, error.isEmpty()
                        ? formatEntrySearchResult(entries) : error);
            });
        });
        submitOnEnter(stroke, lookupStroke);
        submitOnEnter(translation, lookupTranslation);
        addCloseButton();
        focusInitially(translation.getText().length() > 0 ? translation : stroke);
    }

    private void showAddTranslation(String argument) {
        addDescription(R.string.add_translation_description);
        EditText outline = addField(
                R.string.outline_label,
                R.string.outline_hint,
                InputType.TYPE_CLASS_TEXT
                        | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        );
        configureRawOutlineField(outline);

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
        dictionaryGroup = new RadioGroup(this);
        dictionaryGroup.setId(View.generateViewId());
        dictionaryGroup.setOrientation(RadioGroup.VERTICAL);
        dictionaryLabel.setLabelFor(dictionaryGroup.getId());
        content.addView(dictionaryGroup, matchWrap());
        TextView status = addStatus();
        Button add = addButton(R.string.add_translation_action);
        add.setEnabled(false);
        addCloseButton();
        final boolean[] dictionariesLoaded = {false};
        final boolean[] submitting = {false};
        final String[] completedSubmission = {""};

        Runnable updateAddEnabled = () -> add.setEnabled(
                dictionariesLoaded[0]
                        && !submitting[0]
                        && !outline.getText().toString().trim().isEmpty()
                        && !translation.getText().toString().isEmpty()
                        && selectedDictionaryIndex() >= 0
                        && !submissionSignature(outline, translation).equals(
                                completedSubmission[0]
                        )
        );
        TextWatcher formWatcher = new TextWatcher() {
            @Override public void beforeTextChanged(
                    CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(
                    CharSequence value, int start, int before, int count) {
                updateAddEnabled.run();
            }
            @Override public void afterTextChanged(Editable value) {}
        };
        outline.addTextChangedListener(formWatcher);
        translation.addTextChangedListener(formWatcher);
        dictionaryGroup.setOnCheckedChangeListener((group, checkedId) ->
                updateAddEnabled.run());

        showProgress(status, R.string.loading_dictionaries);
        request("get_dictionary_state", new JSONObject(), (result, error) -> {
            if (!error.isEmpty()) {
                showTerminalStatus(status, error);
                return;
            }
            JSONArray state = result.optJSONArray("dictionaries");
            for (int index = 0; state != null && index < state.length(); index++) {
                JSONObject dictionary = state.optJSONObject(index);
                if (dictionary != null
                        && "json".equals(dictionary.optString("type", ""))) {
                    String identifier = dictionary.optString("identifier", "");
                    if (!identifier.isEmpty()) {
                        writableDictionaries.add(identifier);
                    }
                }
            }
            populateDictionaryChoices(status);
            boolean available = !writableDictionaries.isEmpty();
            dictionaryGroup.setEnabled(available);
            dictionaryLabel.setEnabled(available);
            dictionariesLoaded[0] = available;
            updateAddEnabled.run();
            showTerminalStatus(status,
                    available
                            ? R.string.choose_dictionary_and_add
                            : R.string.no_writable_dictionaries
            );
        });

        add.setOnClickListener(view -> {
            String stroke = outline.getText().toString().trim();
            String output = translation.getText().toString();
            if (stroke.isEmpty() || output.isEmpty()) {
                showTerminalStatus(status, R.string.translation_fields_required);
                return;
            }
            int selectedPosition = selectedDictionaryIndex();
            if (selectedPosition < 0
                    || selectedPosition >= writableDictionaries.size()) {
                showTerminalStatus(status, R.string.no_writable_dictionaries);
                return;
            }
            String selected = writableDictionaries.get(selectedPosition);
            String submittedSignature = stroke + "\u0000"
                    + output + "\u0000" + selected;
            submitting[0] = true;
            updateAddEnabled.run();
            showProgress(status, R.string.checking_existing_translation);
            revealFocusedView(status);
            JSONObject params = new JSONObject();
            try {
                params.put("name", selected);
                params.put("stroke", stroke);
                params.put("translation", output);
            } catch (Exception error) {
                showTerminalStatus(status, messageFor(error));
                submitting[0] = false;
                updateAddEnabled.run();
                return;
            }
            class Mutation {
                void run() {
                    showProgress(status, R.string.adding_translation);
                    revealFocusedView(status);
                    request("replace_entry", params, (result, error) -> {
                        submitting[0] = false;
                        if (!error.isEmpty()) {
                            showTerminalStatus(status, error);
                        } else if (result.optBoolean("conflict", false)) {
                            showTerminalStatus(status, R.string.translation_changed_before_replace);
                        } else {
                            completedSubmission[0] = submittedSignature;
                            showTerminalStatus(status, getString(
                                    R.string.translation_added, stroke, selected
                            ));
                        }
                        revealFocusedView(status);
                        updateAddEnabled.run();
                    });
                }
            }
            Mutation mutation = new Mutation();
            request("add_entry_safely", params, (result, error) -> {
                if (!error.isEmpty()) {
                    submitting[0] = false;
                    showTerminalStatus(status, error);
                    revealFocusedView(status);
                    updateAddEnabled.run();
                    return;
                }
                if (!result.optBoolean("conflict", false)) {
                    submitting[0] = false;
                    completedSubmission[0] = submittedSignature;
                    showTerminalStatus(status, getString(
                            R.string.translation_added,
                            result.optString("stroke", stroke), selected
                    ));
                    revealFocusedView(status);
                    updateAddEnabled.run();
                    return;
                }
                String existing = result.optString("existing_translation", "");
                try {
                    params.put("expected_translation", existing);
                } catch (Exception exception) {
                    submitting[0] = false;
                    showTerminalStatus(status, messageFor(exception));
                    updateAddEnabled.run();
                    return;
                }
                if (existing.equals(output)) {
                    submitting[0] = false;
                    completedSubmission[0] = submittedSignature;
                    showTerminalStatus(status, getString(
                            R.string.translation_already_exists, stroke, selected
                    ));
                    revealFocusedView(status);
                    updateAddEnabled.run();
                    return;
                }
                Runnable cancelReplacement = () -> {
                    submitting[0] = false;
                    showTerminalStatus(status, R.string.translation_not_replaced);
                    revealFocusedView(status);
                    updateAddEnabled.run();
                };
                new AlertDialog.Builder(this)
                        .setTitle(R.string.replace_translation_title)
                        .setMessage(getString(
                                R.string.replace_translation_message,
                                stroke, selected, existing, output
                        ))
                        .setNegativeButton(R.string.cancel, (dialog, which) ->
                                cancelReplacement.run())
                        .setPositiveButton(R.string.replace_translation, (dialog, which) ->
                                mutation.run())
                        .setOnCancelListener(dialog -> cancelReplacement.run())
                        .show();
            });
        });
        advanceOnEnter(outline, translation);
        submitMultilineOnCtrlEnter(translation, add);
        focusInitially(outline);
    }

    private void searchExactEntries(String field, String query,
            BooleanSupplier ownsRequest, EntrySearchCallback callback) {
        searchExactEntries(field, query, 1, new JSONArray(), ownsRequest, callback);
    }

    private void searchExactEntries(
            String field,
            String query,
            int page,
            JSONArray accumulated,
            BooleanSupplier ownsRequest,
            EntrySearchCallback callback) {
        if (!ownsRequest.getAsBoolean()) return;
        request("search_entries", PloverEntrySearch.exactParams(field, query, page),
                (result, error) -> {
            if (!ownsRequest.getAsBoolean()) return;
            if (!error.isEmpty()) {
                callback.onResult(accumulated, error);
                return;
            }
            JSONArray entries = result.optJSONArray("entries");
            for (int index = 0; entries != null && index < entries.length(); index++) {
                accumulated.put(entries.opt(index));
            }
            if (PloverEntrySearch.shouldRequestNextPage(
                    result.optBoolean("has_more", false), ownsRequest.getAsBoolean())) {
                searchExactEntries(field, query, page + 1, accumulated,
                        ownsRequest, callback);
            } else {
                callback.onResult(accumulated, "");
            }
        });
    }

    private void searchUnicodeTranslationEntries(String query,
            BooleanSupplier ownsRequest, EntrySearchCallback callback) {
        listUnicodeTranslationEntries(PloverEntrySearch.unicodeLookupKey(query), 1,
                new JSONArray(), ownsRequest, callback);
    }

    private void listUnicodeTranslationEntries(String queryKey, int page,
            JSONArray matches, BooleanSupplier ownsRequest,
            EntrySearchCallback callback) {
        if (!ownsRequest.getAsBoolean()) return;
        request(PloverEntrySearch.ENUMERATE_METHOD,
                PloverEntrySearch.listParams(page), (result, error) -> {
            if (!ownsRequest.getAsBoolean()) return;
            if (!error.isEmpty()) {
                callback.onResult(matches, error);
                return;
            }
            JSONArray entries = result.optJSONArray("entries");
            for (int index = 0; entries != null && index < entries.length(); index++) {
                JSONObject entry = entries.optJSONObject(index);
                if (entry != null && queryKey.equals(PloverEntrySearch.unicodeLookupKey(
                        entry.optString("translation", "")))) {
                    matches.put(entry);
                }
            }
            if (PloverEntrySearch.shouldRequestNextPage(
                    result.optBoolean("has_more", false), ownsRequest.getAsBoolean())) {
                listUnicodeTranslationEntries(queryKey, page + 1, matches,
                        ownsRequest, callback);
            } else {
                callback.onResult(matches, "");
            }
        });
    }

    private String formatEntrySearchResult(JSONArray entries) {
        List<String> rows = new ArrayList<>();
        for (int index = 0; index < entries.length(); index++) {
            JSONObject entry = entries.optJSONObject(index);
            if (entry == null) continue;
            rows.add(entry.optString("stroke", "") + " \u2192 "
                    + entry.optString("translation", "") + "\n"
                    + entry.optString("dictionary", ""));
        }
        return rows.isEmpty() ? getString(R.string.no_lookup_results)
                : android.text.TextUtils.join("\n\n", rows);
    }

    private void showProgress(TextView status) {
        showProgress(status, R.string.looking_up_entries);
    }

    private void showProgress(TextView status, int message) {
        status.setFocusable(false);
        status.setText(message);
        revealFocusedView(status);
    }

    private void showTerminalStatus(TextView status, int message) {
        showTerminalStatus(status, getString(message));
    }

    private void showTerminalStatus(TextView status, String message) {
        status.setText(message);
        status.setFocusable(true);
        revealFocusedView(status);
    }

    private void clearStatus(TextView status) {
        status.setText("");
        status.setFocusable(false);
    }

    private void request(
            String method,
            JSONObject params,
            ResultCallback callback) {
        int generation = commandGeneration;
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
                    if (generation != commandGeneration || isFinishing()) {
                        return;
                    }
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

    private void addDialogTitle(int text) {
        TextView title = new TextView(this);
        title.setText(text);
        title.setTextAppearance(android.R.style.TextAppearance_Material_Headline);
        title.setSingleLine(false);
        title.setPadding(0, 0, 0, dp(12));
        content.addView(title, matchWrap());
    }

    private EditText addField(int labelText, int hintText, int inputType) {
        EditText field = new EditText(this);
        field.setId(View.generateViewId());
        TextView label = addLabel(labelText);
        label.setLabelFor(field.getId());
        field.setHint(hintText);
        field.setInputType(inputType);
        field.setOnFocusChangeListener((view, hasFocus) -> {
            if (hasFocus) {
                PloverCommandFocusState.setNativeControlFocused(false);
            }
        });
        registerFocusable(field);
        content.addView(field, matchWrap());
        return field;
    }

    private void configureRawOutlineField(EditText field) {
        field.setPrivateImeOptions(
                PloverCommandEditorMode.RAW_OUTLINE_IME_OPTION
        );
        field.setImeOptions(EditorInfo.IME_ACTION_NEXT);
    }

    private void submitOnEnter(EditText field, Button submit) {
        field.setImeOptions(
                EditorInfo.IME_ACTION_DONE
                        | EditorInfo.IME_FLAG_NO_EXTRACT_UI
        );
        field.setOnEditorActionListener((view, actionId, event) -> {
            int keyCode = event == null ? KeyEvent.KEYCODE_UNKNOWN : event.getKeyCode();
            int keyAction = event == null ? -1 : event.getAction();
            if (!NativeFormSubmit.shouldSubmit(
                    actionId,
                    keyCode,
                    keyAction
            )) {
                return false;
            }
            if (submit.isEnabled()) {
                submit.performClick();
            }
            return true;
        });
    }

    private void submitMultilineOnCtrlEnter(EditText field, Button submit) {
        field.setImeOptions(EditorInfo.IME_ACTION_NONE
                | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        field.setOnKeyListener((view, keyCode, event) -> {
            boolean enter = keyCode == KeyEvent.KEYCODE_ENTER
                    || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER;
            if (!enter || !event.isCtrlPressed()) {
                return false;
            }
            if (event.getAction() == KeyEvent.ACTION_DOWN
                    && event.getRepeatCount() == 0
                    && submit.isEnabled()) {
                submit.performClick();
            }
            return true;
        });
    }

    private void advanceOnEnter(EditText field, View next) {
        field.setImeOptions(
                EditorInfo.IME_ACTION_NEXT
                        | EditorInfo.IME_FLAG_NO_EXTRACT_UI
        );
        field.setOnEditorActionListener((view, actionId, event) -> {
            int keyCode = event == null ? KeyEvent.KEYCODE_UNKNOWN : event.getKeyCode();
            int keyAction = event == null ? -1 : event.getAction();
            boolean nextAction = actionId == EditorInfo.IME_ACTION_NEXT;
            boolean enterDown = keyCode == KeyEvent.KEYCODE_ENTER
                    && keyAction == KeyEvent.ACTION_DOWN;
            if (!nextAction && !enterDown) {
                return false;
            }
            next.requestFocus();
            revealFocusedView(next);
            showKeyboard(next);
            return true;
        });
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
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        // Register the result at its documented position, but only terminal,
        // selectable content enables it as a Tab stop.
        status.setFocusable(false);
        status.setFocusableInTouchMode(false);
        registerFocusable(status);
        status.setFocusable(false);
        content.addView(status, matchWrap());
        return status;
    }

    private void populateDictionaryChoices(View focusSuccessor) {
        if (dictionaryGroup == null) {
            return;
        }
        dictionaryGroup.removeAllViews();
        dictionaryChoices.clear();
        for (int index = 0; index < writableDictionaries.size(); index++) {
            RadioButton choice = new RadioButton(this);
            choice.setId(View.generateViewId());
            choice.setText((index + 1) + ". " + writableDictionaries.get(index));
            choice.setContentDescription(getString(
                    R.string.dictionary_choice_description,
                    index + 1,
                    writableDictionaries.get(index)
            ));
            choice.setMinHeight(dp(48));
            choice.setPadding(dp(12), dp(8), dp(12), dp(8));
            // Every choice must be able to take focus after its touch click,
            // even though only the first choice represents the group in the
            // custom Tab order.
            configureFocusable(choice);
            dictionaryGroup.addView(choice, matchWrap());
            dictionaryChoices.add(choice);
            choice.setOnClickListener(view -> {
                dictionaryGroup.check(choice.getId());
                choice.requestFocusFromTouch();
                revealFocusedView(choice);
            });
            choice.setOnFocusChangeListener((view, hasFocus) -> {
                if (hasFocus) {
                    PloverCommandFocusState.setNativeControlFocused(true);
                    revealFocusedView(view);
                }
            });
        }
        if (!dictionaryChoices.isEmpty()) {
            registerFocusableBefore(dictionaryChoices.get(0), focusSuccessor);
        }
    }

    private int selectedDictionaryIndex() {
        if (dictionaryGroup == null) {
            return -1;
        }
        int checkedId = dictionaryGroup.getCheckedRadioButtonId();
        for (int index = 0; index < dictionaryChoices.size(); index++) {
            if (dictionaryChoices.get(index).getId() == checkedId) {
                return index;
            }
        }
        return -1;
    }

    private boolean selectDictionaryByShortcut(KeyEvent event) {
        if (dictionaryChoices.isEmpty()) {
            return false;
        }
        View focused = getCurrentFocus();
        boolean focusIsDictionary = focused instanceof RadioButton
                && dictionaryChoices.contains(focused);
        int index = DictionarySelectionShortcut.indexFor(
                event, dictionaryChoices.size(), focusIsDictionary
        );
        if (index < 0) {
            return false;
        }
        RadioButton choice = dictionaryChoices.get(index);
        choice.setChecked(true);
        choice.requestFocus();
        revealFocusedView(choice);
        return true;
    }

    private Button addButton(int text) {
        Button button = new Button(this);
        button.setText(text);
        registerFocusable(button);
        content.addView(button, matchWrap());
        return button;
    }

    private <T extends View> T registerFocusable(T view) {
        configureFocusable(view);
        if (!(view instanceof EditText)) {
            view.setOnFocusChangeListener((focusedView, hasFocus) -> {
                if (hasFocus) {
                    PloverCommandFocusState.setNativeControlFocused(true);
                    revealFocusedView(focusedView);
                }
            });
        }
        focusOrder.add(view);
        return view;
    }

    private <T extends View> T configureFocusable(T view) {
        if (view.getId() == View.NO_ID) {
            view.setId(View.generateViewId());
        }
        view.setFocusable(true);
        // Buttons and radios must remain keyboard-focusable without consuming the
        // first tap merely to enter touch focus mode. Editors retain their normal
        // touch-focus behavior.
        view.setFocusableInTouchMode(
                CommandControlFocusPolicy.focusableInTouchMode(
                        view instanceof EditText
                )
        );
        return view;
    }

    private <T extends View> T registerFocusableBefore(T view, View successor) {
        registerFocusable(view);
        focusOrder.remove(view);
        int successorIndex = focusOrder.indexOf(successor);
        focusOrder.add(successorIndex < 0 ? focusOrder.size() : successorIndex, view);
        return view;
    }

    private void focusInitially(EditText field) {
        int generation = commandGeneration;
        field.post(() -> {
            if (generation != commandGeneration
                    || !field.isAttachedToWindow()) {
                return;
            }
            field.requestFocus();
            field.setSelection(field.getText().length());
            revealFocusedView(field);
            showKeyboard(field);
        });
    }

    private void moveFocus(boolean backwards) {
        if (focusOrder.isEmpty()) {
            return;
        }
        View current = getCurrentFocus();
        if (dictionaryChoices.contains(current) && !dictionaryChoices.isEmpty()) {
            current = dictionaryChoices.get(0);
        }
        int currentIndex = focusOrder.indexOf(current);
        boolean[] eligible = new boolean[focusOrder.size()];
        for (int index = 0; index < focusOrder.size(); index++) {
            View candidate = focusOrder.get(index);
            eligible[index] = candidate.isEnabled()
                    && candidate.getVisibility() == View.VISIBLE
                    && candidate.isFocusable();
        }
        int nextIndex = KeyboardFocusCycle.nextIndex(
                currentIndex,
                backwards,
                eligible
        );
        if (nextIndex >= 0) {
            View candidate = focusOrder.get(nextIndex);
            if (!dictionaryChoices.isEmpty()
                    && candidate == dictionaryChoices.get(0)) {
                int selected = selectedDictionaryIndex();
                if (selected >= 0) {
                    candidate = dictionaryChoices.get(selected);
                }
            }
            candidate.requestFocus();
            revealFocusedView(candidate);
            if (candidate instanceof EditText) {
                showKeyboard(candidate);
            }
        }
    }

    private void showKeyboard(View field) {
        InputMethodManager inputMethodManager =
                getSystemService(InputMethodManager.class);
        if (inputMethodManager != null) {
            inputMethodManager.showSoftInput(
                    field,
                    InputMethodManager.SHOW_IMPLICIT
            );
        }
    }

    private void revealFocusedView(View view) {
        if (scrollView == null) {
            return;
        }
        Rect rectangle = new Rect();
        view.getDrawingRect(rectangle);
        scrollView.offsetDescendantRectToMyCoords(view, rectangle);
        scrollView.requestRectangleOnScreen(rectangle, true);
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

    private static String messageFor(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty()
                ? error.getClass().getSimpleName()
                : message;
    }

    private String submissionSignature(EditText outline, EditText translation) {
        int selected = selectedDictionaryIndex();
        String dictionary = selected >= 0 && selected < writableDictionaries.size()
                ? writableDictionaries.get(selected) : "";
        return outline.getText().toString().trim() + "\u0000"
                + translation.getText().toString() + "\u0000" + dictionary;
    }

    private interface ResultCallback {
        void onResult(JSONObject result, String error);
    }

    private interface EntrySearchCallback {
        void onResult(JSONArray entries, String error);
    }
}
