package com.huynhtrankhanh.v7ime;

import android.os.Handler;
import android.view.inputmethod.InputConnection;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class PloverStrokeSuggestions {
    private static final int CONTEXT_LENGTH = 128;
    private static final int MAX_WORDS = 3;
    private static final int MAX_STROKES = 4;
    private static final long LOOKUP_DELAY_MS = 120L;
    private static final String WORD_PART = "[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N}]*";
    private static final Pattern WORD = Pattern.compile(WORD_PART + "(?:['’-]" + WORD_PART + ")*");
    private static final Pattern PARTIAL_WORD = Pattern.compile("[\\p{L}\\p{M}\\p{N}\\p{Cs}'’-]+");
    private static final Pattern WORD_GAP = Pattern.compile("\\h+");
    private static final Pattern TRAILING = Pattern.compile("[\\p{P}\\h]*\\z");
    private static final Comparator<String> OUTLINE_ORDER =
            Comparator.<String>comparingLong(stroke -> stroke.chars().filter(c -> c == '/').count())
                    .thenComparingInt(String::length)
                    .thenComparing(Comparator.naturalOrder());

    interface Lookup {
        void request(String body, BundledStrippedPloverRuntime.Callback callback);
    }

    interface Publisher {
        void publish(String suggestion, boolean pending);
    }

    private final Handler handler;
    private final Supplier<InputConnection> connection;
    private final Lookup lookup;
    private final Publisher publisher;
    private boolean active;
    private boolean inFlight;
    private Query query;
    private String published = "null";
    private boolean publishedPending;

    private final Runnable scan = this::scanEditor;
    private final Runnable lookupDue = () -> {
        Query due = query;
        scanEditor();
        if (due != null && query == due) {
            due.ready = true;
            requestNext();
        }
    };

    PloverStrokeSuggestions(Handler handler, Supplier<InputConnection> connection,
            Lookup lookup, Publisher publisher) {
        this.handler = handler;
        this.connection = connection;
        this.lookup = lookup;
        this.publisher = publisher;
    }

    void update(boolean enabled) {
        active = enabled;
        handler.removeCallbacks(scan);
        if (active) {
            handler.post(scan);
        } else {
            handler.removeCallbacks(lookupDue);
            query = null;
            publish("null", false);
        }
    }

    private void scanEditor() {
        if (!active) return;
        InputConnection editor = connection.get();
        List<String> candidates = scanCandidates(editor);
        if (query != null && query.editor == editor && query.candidates.equals(candidates)) return;

        handler.removeCallbacks(lookupDue);
        query = candidates.isEmpty() ? null : new Query(editor, candidates);
        // Clear stale suggestion text immediately, while telling the display
        // to hold an already-open strip's height until the pending lookup settles.
        publish("null", query != null);
        if (query != null) handler.postDelayed(lookupDue, LOOKUP_DELAY_MS);
    }

    private static List<String> scanCandidates(InputConnection editor) {
        if (editor == null) return Collections.emptyList();
        CharSequence before;
        try {
            before = editor.getTextBeforeCursor(CONTEXT_LENGTH, 0);
        } catch (RuntimeException unavailable) {
            return Collections.emptyList();
        }
        if (before == null || before.length() == 0) return Collections.emptyList();
        String text = before.subSequence(Math.max(0, before.length() - CONTEXT_LENGTH),
                before.length()).toString();
        Matcher trailing = TRAILING.matcher(text);
        trailing.find();
        Matcher words = WORD.matcher(text).region(0, trailing.start());
        Matcher gap = WORD_GAP.matcher(text);
        List<String> suffix = new ArrayList<>(MAX_WORDS);
        // Skip a potentially clipped word at the start of a full window.
        Matcher partial = PARTIAL_WORD.matcher(text);
        int firstBoundary = text.length() == CONTEXT_LENGTH && partial.lookingAt() ? partial.end() : 0;
        int end = 0;
        while (words.find()) {
            if (!gap.region(end, words.start()).matches()) suffix.clear();
            end = words.end();
            if (words.start() < firstBoundary) continue;
            if (suffix.size() == MAX_WORDS) suffix.remove(0);
            suffix.add(words.group());
        }
        if (end != trailing.start()) return Collections.emptyList();

        List<String> queries = new ArrayList<>(MAX_WORDS * 2);
        for (int i = 0; i < suffix.size(); i++) {
            String phrase = Normalizer.normalize(
                    String.join(" ", suffix.subList(i, suffix.size())), Normalizer.Form.NFC);
            queries.add(phrase);
            String lower = phrase.toLowerCase(Locale.ROOT);
            if (!lower.equals(phrase)) queries.add(lower);
        }
        return queries;
    }

    private void requestNext() {
        Query current = query;
        if (inFlight || current == null || !current.ready) return;
        if (current.nextIndex == current.candidates.size()) {
            publish("null", false);
            return;
        }
        String translation = current.candidates.get(current.nextIndex++);
        JSONObject request;
        try {
            request = new JSONObject().put("id", 0).put("method", "reverse_lookup")
                    .put("params", new JSONObject().put("translation", translation));
        } catch (JSONException invalidRequest) {
            publish("null", false);
            return;
        }
        inFlight = true;
        lookup.request(request.toString(), (body, error) -> {
            inFlight = false;
            scanEditor();
            if (query != current) {
                requestNext();
                return;
            }
            if (!error.isEmpty()) {
                publish("null", false);
                return;
            }
            try {
                String suggestion = parseSuggestion(body, translation);
                if (suggestion == null) requestNext();
                else publish(suggestion, false);
            } catch (JSONException invalidResponse) {
                // A failed lookup settles the row as empty for this context.
                publish("null", false);
            }
        });
    }

    private static String parseSuggestion(String body, String translation) throws JSONException {
        JSONArray strokes = new JSONObject(body).getJSONObject("result").getJSONArray("strokes");
        TreeSet<String> ranked = new TreeSet<>(OUTLINE_ORDER);
        for (int i = 0; i < strokes.length(); i++) {
            Object value = strokes.opt(i);
            if (value instanceof String && !((String) value).isEmpty()) ranked.add((String) value);
            if (ranked.size() > MAX_STROKES) ranked.pollLast();
        }
        return ranked.isEmpty() ? null : new JSONObject().put("translation", translation)
                .put("strokes", new JSONArray(ranked)).toString();
    }

    private void publish(String suggestion, boolean pending) {
        if (suggestion.equals(published) && pending == publishedPending) return;
        published = suggestion;
        publishedPending = pending;
        publisher.publish(suggestion, pending);
    }

    private static final class Query {
        final InputConnection editor;
        final List<String> candidates;
        int nextIndex;
        boolean ready;

        Query(InputConnection editor, List<String> candidates) {
            this.editor = editor;
            this.candidates = candidates;
        }
    }
}
