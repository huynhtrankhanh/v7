package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.text.Editable;
import android.text.Selection;
import android.view.KeyEvent;
import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.widget.EditText;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.AfterClass;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowLooper;
import java.io.*;
import java.util.*;
import java.util.concurrent.Executor;
import static org.junit.Assert.*;

/**
 * Robolectric differential fuzzer comparing V7ImeService Telex mode directly
 * against real ibus-unikey over an isolated IBus session.
 */
@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35, shadows = {
    TelexUniKeyFuzzTest.Sandbox.class,
    TelexUniKeyFuzzTest.Telex.class,
    TelexUniKeyFuzzTest.Inference.class,
    TelexUniKeyFuzzTest.Plover.class
})
@LooperMode(LooperMode.Mode.PAUSED)
public class TelexUniKeyFuzzTest {
    public static class Ime extends V7ImeService {
        InputConnection connection;
        @Override public InputConnection getCurrentInputConnection() { return connection; }
    }

    private static Process nodeProc;
    private static BufferedReader nodeIn;
    private static PrintWriter nodeOut;

    private static Process ibusProc;
    private static BufferedReader ibusIn;
    private static PrintWriter ibusOut;

    private static File findRoot() throws IOException {
        File root = new File(System.getProperty("v7.test.root", ".")).getCanonicalFile();
        while (root != null && !new File(root, "scripts/native-ime-fuzz-host.cjs").isFile()) {
            root = root.getParentFile();
        }
        if (root == null) throw new IOException("Cannot locate repo root");
        return root;
    }

    private static synchronized JSONObject nodeRpc(JSONObject call) throws Exception {
        if (nodeProc == null) {
            File root = findRoot();
            nodeProc = new ProcessBuilder("node", new File(root, "scripts/native-ime-fuzz-host.cjs").getPath())
                    .redirectError(ProcessBuilder.Redirect.INHERIT).start();
            nodeIn = new BufferedReader(new InputStreamReader(nodeProc.getInputStream()));
            nodeOut = new PrintWriter(nodeProc.getOutputStream(), true);
        }
        nodeOut.println(call);
        String line = nodeIn.readLine();
        if (line == null) throw new IOException("Node host stopped");
        JSONObject packet = new JSONObject(line);
        if (packet.has("hostError")) throw new IOException(packet.getString("hostError"));
        return packet;
    }

    private static synchronized JSONObject ibusRpc(JSONObject call) throws Exception {
        if (ibusProc == null) {
            File root = findRoot();
            ibusProc = new ProcessBuilder("python3", new File(root, "scripts/ibus-unikey-oracle.py").getPath())
                    .redirectError(ProcessBuilder.Redirect.INHERIT).start();
            ibusIn = new BufferedReader(new InputStreamReader(ibusProc.getInputStream()));
            ibusOut = new PrintWriter(ibusProc.getOutputStream(), true);
        }
        ibusOut.println(call);
        String line = ibusIn.readLine();
        if (line == null) throw new IOException("ibus-unikey oracle stopped");
        JSONObject packet = new JSONObject(line);
        if (packet.has("error")) throw new IOException("ibus-unikey error: " + packet.getString("error"));
        return packet;
    }

    @AfterClass
    public static void stopHelpers() {
        if (nodeProc != null) { nodeProc.destroyForcibly(); nodeProc = null; }
        if (ibusProc != null) { ibusProc.destroyForcibly(); ibusProc = null; }
    }

    @Implements(value = ImeJavaScriptSandbox.class, isInAndroidSdk = false)
    public static class Sandbox {
        private boolean ready;
        @Implementation protected void warmAsync(Executor executor, Runnable changed) {
            ready = true;
            changed.run();
        }
        @Implementation protected boolean isReady() { return ready; }
        @Implementation protected long generation() { return 1L; }
        @Implementation protected JSONObject dispatch(JSONObject command) { return new JSONObject(); }
        @Implementation protected JSONObject reply(int id, String value, String error) { return new JSONObject(); }
        @Implementation protected void close() { ready = false; }
    }

    @Implements(value = TelexJavaScriptSandbox.class, isInAndroidSdk = false)
    public static class Telex {
        private boolean ready;
        @Implementation protected void warmAsync(Executor executor, Runnable changed) {
            ready = true;
            changed.run();
        }
        @Implementation protected boolean isReady() { return ready; }
        @Implementation protected String convertIfReady(String raw) {
            if (!ready) return null;
            try { return nodeRpc(new JSONObject().put("telex", raw)).getString("text"); }
            catch (Exception e) { throw new AssertionError(e); }
        }
        @Implementation protected TelexJavaScriptSandbox.StepResult stepKeyIfReady(String key) {
            if (!ready) return null;
            try {
                return TelexJavaScriptSandbox.StepResult.parse(
                        nodeRpc(new JSONObject().put("telexStepKey", key)).getString("result"));
            } catch (Exception e) { throw new AssertionError(e); }
        }
        @Implementation protected TelexJavaScriptSandbox.StepResult stepBackspaceIfReady() {
            if (!ready) return null;
            try {
                return TelexJavaScriptSandbox.StepResult.parse(
                        nodeRpc(new JSONObject().put("telexStepBackspace", true)).getString("result"));
            } catch (Exception e) { throw new AssertionError(e); }
        }
        @Implementation protected TelexJavaScriptSandbox.StepResult replayActionsIfReady(String actionsJson) {
            if (!ready) return null;
            try {
                return TelexJavaScriptSandbox.StepResult.parse(
                        nodeRpc(new JSONObject().put("telexReplay", actionsJson)).getString("result"));
            } catch (Exception e) { throw new AssertionError(e); }
        }
        @Implementation protected void resetIfReady() {
            if (!ready) return;
            try { nodeRpc(new JSONObject().put("telexReset", true)); }
            catch (Exception e) { throw new AssertionError(e); }
        }
        @Implementation protected void close() { ready = false; }
    }

    @Implements(value = NativeInference.class, isInAndroidSdk = false)
    public static class Inference {
        @Implementation protected static String infer(Context context, String body) {
            return "{\"candidates\":[]}";
        }
    }

    @Implements(value = BundledStrippedPloverRuntime.class, isInAndroidSdk = false)
    public static class Plover {
        @Implementation protected boolean isPaused() { return false; }
        @Implementation protected void attachTo(FrameLayout host) {}
        @Implementation protected void detachFrom(FrameLayout host) {}
        @Implementation protected void addStateListener(BundledStrippedPloverRuntime.StateListener l) {}
        @Implementation protected void removeStateListener(BundledStrippedPloverRuntime.StateListener l) {}
        @Implementation protected void addEventListener(BundledStrippedPloverRuntime.EventListener l) {}
        @Implementation protected void removeEventListener(BundledStrippedPloverRuntime.EventListener l) {}
        @Implementation protected void request(String body, BundledStrippedPloverRuntime.Callback cb) {}
    }

    private static class Host extends BaseInputConnection {
        final Ime ime;
        final EditText editor;
        boolean omitBounds;
        boolean extractionUnavailable;
        boolean surroundingUnavailable;
        final List<Runnable> deferredSelections = new ArrayList<>();
        boolean deferSelections;

        Host(Ime ime) {
            super(new EditText(ime), true);
            this.ime = ime;
            this.editor = new EditText(ime);
            this.editor.setText("");
            Selection.setSelection(this.editor.getText(), 0);
        }
        @Override public Editable getEditable() { return editor.getText(); }

        @Override public android.view.inputmethod.ExtractedText getExtractedText(
                android.view.inputmethod.ExtractedTextRequest request, int flags) {
            if (extractionUnavailable) return null;
            android.view.inputmethod.ExtractedText et = new android.view.inputmethod.ExtractedText();
            et.text = getEditable().toString();
            et.startOffset = 0;
            et.selectionStart = Selection.getSelectionStart(getEditable());
            et.selectionEnd = Selection.getSelectionEnd(getEditable());
            return et;
        }

        @Override public android.view.inputmethod.SurroundingText getSurroundingText(int b, int a, int f) {
            return surroundingUnavailable ? null : super.getSurroundingText(b, a, f);
        }

        void flushSelections() {
            while (!deferredSelections.isEmpty()) {
                deferredSelections.remove(0).run();
            }
        }

        private void notifySelection(int oldStart, int oldEnd) {
            int curS = Selection.getSelectionStart(getEditable());
            int curE = Selection.getSelectionEnd(getEditable());
            int cs = omitBounds ? -1 : getComposingSpanStart(getEditable());
            int ce = omitBounds ? -1 : getComposingSpanEnd(getEditable());
            Runnable cb = () -> ime.onUpdateSelection(oldStart, oldEnd, curS, curE, cs, ce);
            if (deferSelections) deferredSelections.add(cb);
            else cb.run();
        }

        @Override public boolean setComposingText(CharSequence text, int pos) {
            int oldS = Selection.getSelectionStart(getEditable());
            int oldE = Selection.getSelectionEnd(getEditable());
            boolean res = super.setComposingText(text, pos);
            notifySelection(oldS, oldE);
            return res;
        }
        @Override public boolean commitText(CharSequence text, int pos) {
            int oldS = Selection.getSelectionStart(getEditable());
            int oldE = Selection.getSelectionEnd(getEditable());
            boolean res = super.commitText(text, pos);
            notifySelection(oldS, oldE);
            return res;
        }
        @Override public boolean finishComposingText() {
            int oldS = Selection.getSelectionStart(getEditable());
            int oldE = Selection.getSelectionEnd(getEditable());
            boolean res = super.finishComposingText();
            notifySelection(oldS, oldE);
            return res;
        }

        private static int prevWordPos(CharSequence text, int pos) {
            int cut = pos;
            while (cut > 0 && Character.isWhitespace(text.charAt(cut - 1))) cut--;
            while (cut > 0 && !Character.isWhitespace(text.charAt(cut - 1))) cut--;
            return cut;
        }

        private static int nextWordPos(CharSequence text, int pos) {
            int n = text.length(), cut = pos;
            while (cut < n && !Character.isWhitespace(text.charAt(cut))) cut++;
            while (cut < n && Character.isWhitespace(text.charAt(cut))) cut++;
            return cut;
        }

        @Override public boolean sendKeyEvent(KeyEvent event) {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return true;
            Editable ed = getEditable();
            int start = Selection.getSelectionStart(ed);
            int end = Selection.getSelectionEnd(ed);
            int lo = Math.min(start, end);
            int hi = Math.max(start, end);
            int code = event.getKeyCode();
            if (code == KeyEvent.KEYCODE_ENTER) {
                super.finishComposingText();
                ed.replace(lo, hi, "\n");
                Selection.setSelection(ed, lo + 1);
                notifySelection(start, end);
                return true;
            }
            if (code == KeyEvent.KEYCODE_A && event.isCtrlPressed()) {
                Selection.setSelection(ed, 0, ed.length());
                notifySelection(start, end);
                return true;
            }
            if (code == KeyEvent.KEYCODE_DEL && event.isCtrlPressed()) {
                if (lo != hi) {
                    ed.delete(lo, hi);
                    Selection.setSelection(ed, lo);
                } else {
                    int cut = prevWordPos(ed, lo);
                    ed.delete(cut, lo);
                    Selection.setSelection(ed, cut);
                }
                notifySelection(start, end);
                return true;
            }
            if (code == KeyEvent.KEYCODE_DEL) {
                if (lo != hi) {
                    ed.delete(lo, hi);
                    Selection.setSelection(ed, lo);
                } else if (lo > 0) {
                    ed.delete(lo - 1, lo);
                    Selection.setSelection(ed, lo - 1);
                }
                notifySelection(start, end);
                return true;
            }
            if (code == KeyEvent.KEYCODE_FORWARD_DEL) {
                if (lo != hi) {
                    ed.delete(lo, hi);
                    Selection.setSelection(ed, lo);
                } else if (lo < ed.length()) {
                    ed.delete(lo, lo + 1);
                    Selection.setSelection(ed, lo);
                }
                notifySelection(start, end);
                return true;
            }
            if (code == KeyEvent.KEYCODE_DPAD_LEFT) {
                if (event.isShiftPressed()) {
                    int next = event.isCtrlPressed() ? prevWordPos(ed, end) : Math.max(0, end - 1);
                    Selection.setSelection(ed, start, next);
                } else {
                    int next = event.isCtrlPressed() ? prevWordPos(ed, end)
                            : (lo != hi ? lo : Math.max(0, end - 1));
                    Selection.setSelection(ed, next);
                }
                notifySelection(start, end);
                return true;
            }
            if (code == KeyEvent.KEYCODE_DPAD_RIGHT) {
                if (event.isShiftPressed()) {
                    int next = event.isCtrlPressed() ? nextWordPos(ed, end) : Math.min(ed.length(), end + 1);
                    Selection.setSelection(ed, start, next);
                } else {
                    int next = event.isCtrlPressed() ? nextWordPos(ed, end)
                            : (lo != hi ? hi : Math.min(ed.length(), end + 1));
                    Selection.setSelection(ed, next);
                }
                notifySelection(start, end);
                return true;
            }
            if (code == KeyEvent.KEYCODE_MOVE_HOME) {
                if (event.isShiftPressed()) Selection.setSelection(ed, start, 0);
                else Selection.setSelection(ed, 0);
                notifySelection(start, end);
                return true;
            }
            if (code == KeyEvent.KEYCODE_MOVE_END) {
                if (event.isShiftPressed()) Selection.setSelection(ed, start, ed.length());
                else Selection.setSelection(ed, ed.length());
                notifySelection(start, end);
                return true;
            }
            if (HardwareEditorKeyPolicy.isModifier(code)) return true;
            int u = event.getUnicodeChar();
            if (u != 0 && Character.isValidCodePoint(u)) {
                String ch = new String(Character.toChars(u));
                ed.replace(lo, hi, ch);
                Selection.setSelection(ed, lo + ch.length());
                notifySelection(start, end);
            }
            return true;
        }

        String text() { return editor.getText().toString(); }
        int selStart() { return Selection.getSelectionStart(getEditable()); }
        int selEnd() { return Selection.getSelectionEnd(getEditable()); }
        String preedit() {
            int s = getComposingSpanStart(getEditable());
            int e = getComposingSpanEnd(getEditable());
            if (s < 0 || e < s) return "";
            return getEditable().subSequence(s, e).toString();
        }
    }

    private static long eventTime = 1;

    private static void switchToTelex(Ime ime) {
        ime.onKeyDown(KeyEvent.KEYCODE_CTRL_LEFT, new KeyEvent(0, ++eventTime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_CTRL_LEFT, 0, KeyEvent.META_CTRL_ON));
        ime.onKeyDown(KeyEvent.KEYCODE_TAB, new KeyEvent(0, ++eventTime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_TAB, 0, KeyEvent.META_CTRL_ON));
        ime.onKeyUp(KeyEvent.KEYCODE_TAB, new KeyEvent(0, ++eventTime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_TAB, 0, KeyEvent.META_CTRL_ON));
        ime.onKeyUp(KeyEvent.KEYCODE_CTRL_LEFT, new KeyEvent(0, ++eventTime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_CTRL_LEFT, 0, 0));
    }

    private static int[] keyCodeAndMeta(char ch) {
        if (ch >= 'a' && ch <= 'z') return new int[]{KeyEvent.KEYCODE_A + (ch - 'a'), 0};
        if (ch >= 'A' && ch <= 'Z') return new int[]{KeyEvent.KEYCODE_A + (ch - 'A'), KeyEvent.META_SHIFT_ON};
        if (ch >= '0' && ch <= '9') return new int[]{KeyEvent.KEYCODE_0 + (ch - '0'), 0};
        return switch (ch) {
            case ' ' -> new int[]{KeyEvent.KEYCODE_SPACE, 0};
            case '\t' -> new int[]{KeyEvent.KEYCODE_TAB, 0};
            case '\n' -> new int[]{KeyEvent.KEYCODE_ENTER, 0};
            case '\b' -> new int[]{KeyEvent.KEYCODE_DEL, 0};
            case '[' -> new int[]{KeyEvent.KEYCODE_LEFT_BRACKET, 0};
            case ']' -> new int[]{KeyEvent.KEYCODE_RIGHT_BRACKET, 0};
            case '{' -> new int[]{KeyEvent.KEYCODE_LEFT_BRACKET, KeyEvent.META_SHIFT_ON};
            case '}' -> new int[]{KeyEvent.KEYCODE_RIGHT_BRACKET, KeyEvent.META_SHIFT_ON};
            case '.' -> new int[]{KeyEvent.KEYCODE_PERIOD, 0};
            case ',' -> new int[]{KeyEvent.KEYCODE_COMMA, 0};
            case '-' -> new int[]{KeyEvent.KEYCODE_MINUS, 0};
            case ';' -> new int[]{KeyEvent.KEYCODE_SEMICOLON, 0};
            case ':' -> new int[]{KeyEvent.KEYCODE_SEMICOLON, KeyEvent.META_SHIFT_ON};
            case '\'' -> new int[]{KeyEvent.KEYCODE_APOSTROPHE, 0};
            case '"' -> new int[]{KeyEvent.KEYCODE_APOSTROPHE, KeyEvent.META_SHIFT_ON};
            case '/' -> new int[]{KeyEvent.KEYCODE_SLASH, 0};
            case '?' -> new int[]{KeyEvent.KEYCODE_SLASH, KeyEvent.META_SHIFT_ON};
            case '!' -> new int[]{KeyEvent.KEYCODE_1, KeyEvent.META_SHIFT_ON};
            case '(' -> new int[]{KeyEvent.KEYCODE_9, KeyEvent.META_SHIFT_ON};
            case ')' -> new int[]{KeyEvent.KEYCODE_0, KeyEvent.META_SHIFT_ON};
            default -> throw new IllegalArgumentException("Unsupported char: " + ch);
        };
    }

    private static void sendAndroidKey(Ime ime, Host host, char ch) {
        int[] km = keyCodeAndMeta(ch);
        int code = km[0], meta = km[1];
        KeyEvent down = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_DOWN, code, 0, meta);
        boolean handledDown = ime.onKeyDown(code, down);
        if (!handledDown) host.sendKeyEvent(down);
        KeyEvent up = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_UP, code, 0, meta);
        boolean handledUp = ime.onKeyUp(code, up);
        if (!handledUp) host.sendKeyEvent(up);
        ShadowLooper.idleMainLooper();
    }

    private static JSONObject toIbusStep(char ch) throws Exception {
        if (ch == '\b') return new JSONObject().put("kind", "backspace");
        if (ch == '\n') return new JSONObject().put("kind", "enter");
        if (ch == '\t') return new JSONObject().put("kind", "tab");
        boolean shift = (ch >= 'A' && ch <= 'Z') || "{}?!:\"\'()".indexOf(ch) >= 0;
        return new JSONObject().put("kind", "char").put("ch", String.valueOf(ch)).put("shift", shift);
    }

    private static String printableSeq(String seq) {
        return seq.replace("\b", "<BS>").replace("\n", "<NL>").replace("\t", "<TAB>");
    }

    private record Mismatch(String label, String seq, int stepIdx, String prefixSeq,
                            String expectedText, String actualText,
                            String expectedFinal, String actualFinal) {}

    private static void compareSequence(
            String label, String seq, boolean reportOnly, List<Mismatch> mismatches) throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime);
        ime.connection = host;
        EditorInfo info = new EditorInfo();
        info.initialSelStart = info.initialSelEnd = 0;
        ime.onStartInput(info, false);
        ShadowLooper.idleMainLooper();
        switchToTelex(ime);
        ShadowLooper.idleMainLooper();

        JSONArray steps = new JSONArray();
        for (int i = 0; i < seq.length(); i++) steps.put(toIbusStep(seq.charAt(i)));
        JSONArray ibusResults = ibusRpc(new JSONObject().put("op", "batch").put("reset", true).put("steps", steps))
                .getJSONArray("results");

        int firstDiffIdx = -1;
        String firstExp = null, firstAct = null;
        for (int i = 0; i < seq.length(); i++) {
            sendAndroidKey(ime, host, seq.charAt(i));
            String exp = ibusResults.getJSONObject(i).getString("text");
            String act = host.text();
            if (!exp.equals(act) && firstDiffIdx < 0) {
                firstDiffIdx = i;
                firstExp = exp;
                firstAct = act;
            }
        }
        String finalExp = seq.isEmpty() ? "" : ibusResults.getJSONObject(seq.length() - 1).getString("text");
        String finalAct = host.text();
        ime.onDestroy();

        if (firstDiffIdx >= 0) {
            Mismatch m = new Mismatch(label, seq, firstDiffIdx, seq.substring(0, firstDiffIdx + 1),
                    firstExp, firstAct, finalExp, finalAct);
            mismatches.add(m);
            if (!reportOnly) {
                fail(String.format("[%s] seq=%s diverged at step %d (%s): ibus=%s vs v7=%s (final: ibus=%s vs v7=%s)",
                        label, printableSeq(seq), firstDiffIdx, printableSeq(m.prefixSeq),
                        m.expectedText, m.actualText, m.expectedFinal, m.actualFinal));
            }
        }
    }

    @Test
    public void fuzzTelexAgainstIbusUniKey() throws Exception {
        boolean reportOnly = Boolean.getBoolean("v7.telex.reportOnly");
        int seeds = Integer.getInteger("v7.telex.seeds", 40);
        int steps = Integer.getInteger("v7.telex.steps", 40);
        int firstSeed = Integer.getInteger("v7.telex.firstSeed", 0);

        List<Mismatch> mismatches = new ArrayList<>();

        // 1. Curated targeted corpus covering Vietnamese syllables, delayed marks,
        //    tone movement, English auto-restore, backspace, brackets, mixed case, punctuation.
        String[] curated = {
            // Core Vietnamese syllables & delayed shapes
            "tieengs ", "Vieetj ", "dduwowngf ", "dduowngf ", "DDUOWNGF ", "dduongwf ", "duongwfd ",
            "vietej ", "namw ", "toio ", "caua ", "caya ", "tieue ", "tieues ",
            // Tone placement & movement
            "hoaf ", "hoafng ", "hofang ", "oaf ", "hoas ", "khoas ", "quys ", "tuys ",
            "quas ", "quaws ", "quow ", "quows ", "quyeens ", "nguyeenx ", "khuyeens ",
            "gias ", "gis ", "giis ", "giengs ", "gieengs ", "giays ", "giaays ", "giuwax ", "giuawx ",
            "toanf ", "toanfs ", "toansf ", "toansz ", "toanszz ",
            // uo/uow/thuo/huo/khuo/ua/uu
            "thuow ", "thuowr ", "thuoww ", "thuown ", "thuowng ", "thuowngf ", "thuowc ", "thuowcs ",
            "thuowi ", "thuowu ", "huow ", "huowr ", "huowu ", "huowng ", "khuow ", "khuowr ", "khuowng ",
            "tuow ", "tuowng ", "uow ", "uowng ", "uowi ", "uowu ",
            "ruowuj ", "ruoujw ", "ruouwj ", "huouw ",
            "muaw ", "muwa ", "cuaw ", "chuaw ", "nuawx ", "luuw ", "cuuw ", "huuw ",
            "hoaw ", "hoawc ", "khoaw ", "quaw ", "quawn ",
            // Cross-mark switches
            "aaw ", "awa ", "oow ", "owo ", "aaws ", "awas ", "oows ", "owos ",
            // z tone-zero
            "aaz ", "aasz ", "awz ", "owz ", "uwz ", "ddz ", "dduongwfz ", "muowmz ", "worldz ", "serverz ",
            // Escape repeats
            "ass ", "asss ", "aaa ", "aaaaa ", "aww ", "ddd ", "ddddd ", "toanff ",
            "ww ", "wwwww ", "w ", "tw ", "tww ", "tws ", "W ", "WW ", "Ww ", "wW ", "Dd ", "dD ", "DD ",
            // Bracket shortcuts
            "t[ ", "t] ", "t{ ", "t} ", "t[s ", "t]s ", "t{s ", "t}s ",
            "[[ ", "]] ", "{{ ", "}} ", "t[[ ", "t]] ", "t{{ ", "t}} ", "[] ",
            // English & non-Vietnamese words (spell-check & auto-restore)
            "windows ", "Windows ", "WWindowws ", "guitar ", "guitarr ", "server ", "system ",
            "cases ", "test ", "the ", "world ", "water ", "word ", "would ", "hello ",
            "software ", "browser ", "developer ", "keyboard ", "android ", "buffer ", "error ",
            "frozen ", "horizon ", "analyze ", "wizard ",
            "add ", "address ", "middle ", "padding ", "reddit ", "odd ", "sudden ", "hidden ",
            "uoes ", "world.", "tieengs.", "tieengs,", "tieengs!", "tieengs?", "tieengs\n", "tieengs\t",
            "tieengs1 ", "windows1 ",
            // Backspace editing
            "tieengs\b ", "tieengs\bg ", "tieengs\bs ", "tieengs\b\b ", "tieengs\b\be ", "tieengs\b\b\b ",
            "hoafng\b ", "hoafng\b\b ", "thuowng\b ", "thuowng\b\b ", "dduowngf\b\b ",
            "windows\b\b ", "xin chaof\b\b\b\b\b\b ",
            "a\b", "aa\b", "aa\ba ", "w\b", "t[\b", "t[\b[ ",
            // Multi-word sentences
            "xin chaof thees gioiwsi! ",
            "tooi ddang gox tieengs Vieetj treen Android. ",
            "Windows vaaf Linux ddeeuf hoox trowj Unicode. "
        };

        for (String seq : curated) {
            compareSequence("curated", seq, reportOnly, mismatches);
        }

        // 2. UX-focused differential fuzzing across Vietnamese syllables (canonical,
        //    delayed shapes, early tones, tone replacement, mixed case), English words,
        //    bracket shortcuts, punctuation/Tab/Enter separators, and backspace edits.
        //    (Deliberately avoids known non-UX ibus-unikey engine bugs: silent character
        //    deletion on bracket auto-restore, `dd` bypassing spell-check on garbage,
        //    and `quw` -> `quư`.)
        String[] onsets = {"", "b", "c", "ch", "d", "g", "gh", "gi", "h", "k", "kh", "l",
            "m", "n", "ng", "ngh", "nh", "p", "ph", "qu", "r", "s", "t", "th", "tr", "v", "x"};
        String[] vowels = {"a", "aa", "aw", "e", "ee", "i", "o", "oo", "ow", "u", "uw", "y",
            "ai", "ao", "au", "ay", "eo", "ia", "ie", "iee", "iu", "oa", "oaw",
            "oe", "oi", "ooi", "owi", "ua", "uaw", "ue", "uee", "ui", "uo", "uoo", "uow", "uwow",
            "uy", "uya", "uye", "uyee", "uoi", "uooi", "uowi", "uou", "uowu", "uu", "uuw", "ye", "yee", "ieu", "ieeu"};
        String[] codas = {"", "c", "ch", "m", "n", "ng", "nh", "p", "t"};
        String[] mods = {"", "s", "f", "r", "x", "j", "z", "w", "a", "e", "o", "ss", "ff", "ww", "aa"};
        String[] seps = {" ", ".", ",", "!", "?", ";", ":", "-", "\n", "\t"};
        String[] english = {"windows", "server", "system", "guitar", "world", "water", "would",
            "cases", "error", "buffer", "return", "switch", "import", "export", "android",
            "keyboard", "software", "browser", "default", "class", "function", "while", "where",
            "other", "after", "before", "under", "first", "great", "small", "right", "house",
            "frozen", "horizon", "analyze", "wizard", "unicode", "linux", "kernel", "thread"};
        String[] validVnWords = {"tieengs", "Vieetj", "dduowngf", "dduongwf", "duongwfd", "thuowr",
            "thuowng", "thuowngf", "hoafng", "hofang", "nguyeenx", "khuyeens", "quyeens",
            "gieengs", "giengs", "giuwax", "ruowuj", "ruoujw", "huowu", "muaw", "luuw",
            "toanfs", "toansz", "vietej", "namw", "caua", "toio", "tieue", "quys", "tuys",
            "ddeeuf", "hoox", "trowj", "treen", "ddang", "tooi", "chaof", "xin", "gioiws"};
        String[] bracketPatterns = {"t[", "t]", "t{", "t}", "t[s", "t]s", "t{s", "t}s",
            "[[", "]]", "{{", "}}", "t[[", "t]]", "t{{", "t}}", "[]", "t][", "t][ng", "t[n", "u[n"};

        for (int seed = firstSeed; seed < firstSeed + seeds; seed++) {
            Random rng = new Random(seed * 2654435761L + 17);
            StringBuilder sb = new StringBuilder();
            for (int w = 0; w < Math.max(1, steps / 6); w++) {
                int kind = rng.nextInt(5);
                if (kind == 0) {
                    // Real Vietnamese words with case variation and optional backspace + retype
                    String word = validVnWords[rng.nextInt(validVnWords.length)];
                    if (rng.nextInt(4) == 0) word = word.toUpperCase(Locale.ROOT);
                    else if (rng.nextInt(3) == 0)
                        word = Character.toUpperCase(word.charAt(0)) + word.substring(1);
                    sb.append(word);
                    if (rng.nextInt(3) == 0 && !word.toLowerCase(Locale.ROOT).startsWith("dd")) {
                        int bs = 1 + rng.nextInt(Math.min(3, word.length()));
                        for (int b = 0; b < bs; b++) sb.append('\b');
                        if (rng.nextBoolean()) sb.append("ng".charAt(rng.nextInt(2)));
                    }
                } else if (kind == 1) {
                    // Structured syllable combinations (valid + near-valid)
                    String onset = onsets[rng.nextInt(onsets.length)];
                    String vowel = vowels[rng.nextInt(vowels.length)];
                    String coda = codas[rng.nextInt(codas.length)];
                    String mod = mods[rng.nextInt(mods.length)];
                    String word = onset + vowel + coda + mod;
                    if (rng.nextInt(4) == 0) word = word.toUpperCase(Locale.ROOT);
                    else if (rng.nextInt(4) == 0 && !word.isEmpty())
                        word = Character.toUpperCase(word.charAt(0)) + word.substring(1);
                    sb.append(word);
                } else if (kind == 2) {
                    // English words with capitalization and occasional backspace
                    String word = english[rng.nextInt(english.length)];
                    if (rng.nextInt(3) == 0) word = Character.toUpperCase(word.charAt(0)) + word.substring(1);
                    sb.append(word);
                    if (rng.nextInt(5) == 0) sb.append('\b').append((char) ('a' + rng.nextInt(26)));
                } else if (kind == 3) {
                    // Bracket shortcut patterns with optional backspace
                    String pat = bracketPatterns[rng.nextInt(bracketPatterns.length)];
                    sb.append(pat);
                    if (rng.nextInt(4) == 0) sb.append('\b');
                } else {
                    // Mixed lowercase/uppercase Latin words (e.g., identifiers / typos)
                    int len = 2 + rng.nextInt(6);
                    for (int i = 0; i < len; i++) {
                        char c = (char) ('a' + rng.nextInt(26));
                        if (i == 0 && c == 'd') c = 't';
                        if (rng.nextInt(5) == 0) c = Character.toUpperCase(c);
                        sb.append(c);
                    }
                }
                sb.append(seps[rng.nextInt(seps.length)]);
            }
            compareSequence("fuzz-" + seed, sb.toString(), reportOnly, mismatches);
        }

        if (reportOnly) {
            System.out.println("=== TOTAL MISMATCHES: " + mismatches.size()
                    + " / " + (curated.length + seeds) + " sequences ===");
            int shown = 0;
            for (Mismatch m : mismatches) {
                if (shown < 120) {
                    System.out.printf("  [%s] seq=%s | step %d (%s): ibus=%s vs v7=%s | final: ibus=%s vs v7=%s%n",
                            m.label, printableSeq(m.seq), m.stepIdx, printableSeq(m.prefixSeq),
                            m.expectedText, m.actualText, m.expectedFinal, m.actualFinal);
                    shown++;
                }
            }
        } else {
            System.out.println("Telex vs ibus-unikey Robolectric fuzzing PASSED: "
                    + curated.length + " curated + " + seeds + " fuzzed sequences (0 discrepancies)");
        }
    }

    private static void sendAndroidNavOrShortcut(
            Ime ime, Host host, String kind, boolean releaseModifiersFirst) {
        boolean ctrl = kind.startsWith("ctrl_");
        boolean shift = kind.contains("shift_");
        int code = switch (kind) {
            case "ctrl_a" -> KeyEvent.KEYCODE_A;
            case "ctrl_backspace" -> KeyEvent.KEYCODE_DEL;
            case "forward_delete" -> KeyEvent.KEYCODE_FORWARD_DEL;
            case "left", "ctrl_left", "shift_left", "ctrl_shift_left" -> KeyEvent.KEYCODE_DPAD_LEFT;
            case "right", "ctrl_right", "shift_right", "ctrl_shift_right" -> KeyEvent.KEYCODE_DPAD_RIGHT;
            case "home", "shift_home" -> KeyEvent.KEYCODE_MOVE_HOME;
            case "end", "shift_end" -> KeyEvent.KEYCODE_MOVE_END;
            default -> throw new IllegalArgumentException("Unknown nav kind: " + kind);
        };
        int meta = (ctrl ? KeyEvent.META_CTRL_ON : 0) | (shift ? KeyEvent.META_SHIFT_ON : 0);
        if (ctrl) {
            KeyEvent cd = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_CTRL_LEFT, 0, KeyEvent.META_CTRL_ON);
            if (!ime.onKeyDown(KeyEvent.KEYCODE_CTRL_LEFT, cd)) host.sendKeyEvent(cd);
        }
        if (shift) {
            KeyEvent sd = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_SHIFT_LEFT, 0, meta);
            if (!ime.onKeyDown(KeyEvent.KEYCODE_SHIFT_LEFT, sd)) host.sendKeyEvent(sd);
        }
        KeyEvent kd = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_DOWN, code, 0, meta);
        if (!ime.onKeyDown(code, kd)) host.sendKeyEvent(kd);
        if (releaseModifiersFirst) {
            if (shift) {
                int rem = ctrl ? KeyEvent.META_CTRL_ON : 0;
                KeyEvent su = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SHIFT_LEFT, 0, rem);
                if (!ime.onKeyUp(KeyEvent.KEYCODE_SHIFT_LEFT, su)) host.sendKeyEvent(su);
            }
            if (ctrl) {
                KeyEvent cu = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_CTRL_LEFT, 0, 0);
                if (!ime.onKeyUp(KeyEvent.KEYCODE_CTRL_LEFT, cu)) host.sendKeyEvent(cu);
            }
            KeyEvent ku = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_UP, code, 0, 0);
            if (!ime.onKeyUp(code, ku)) host.sendKeyEvent(ku);
        } else {
            KeyEvent ku = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_UP, code, 0, meta);
            if (!ime.onKeyUp(code, ku)) host.sendKeyEvent(ku);
            if (shift) {
                int rem = ctrl ? KeyEvent.META_CTRL_ON : 0;
                KeyEvent su = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SHIFT_LEFT, 0, rem);
                if (!ime.onKeyUp(KeyEvent.KEYCODE_SHIFT_LEFT, su)) host.sendKeyEvent(su);
            }
            if (ctrl) {
                KeyEvent cu = new KeyEvent(0, ++eventTime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_CTRL_LEFT, 0, 0);
                if (!ime.onKeyUp(KeyEvent.KEYCODE_CTRL_LEFT, cu)) host.sendKeyEvent(cu);
            }
        }
        ShadowLooper.idleMainLooper();
    }

    @Test
    public void fuzzTelexEditingNavigationAndSelectionAgainstIbusUniKey() throws Exception {
        int seeds = Math.max(40, Integer.getInteger("v7.telex.seeds", 40));
        int stepsPerSeed = Math.max(35, Integer.getInteger("v7.telex.steps", 40));
        int firstSeed = Integer.getInteger("v7.telex.firstSeed", 0);

        String[] words = {"tieengs", "Vieetj", "dduongwf", "thuowng", "hoafng", "chaof",
            "xin", "nguyeenx", "quyeens", "windows", "server", "add", "middle"};
        String[] navOps = {"ctrl_a", "ctrl_backspace", "forward_delete",
            "left", "right", "ctrl_left", "ctrl_right", "home", "end",
            "shift_left", "shift_right", "ctrl_shift_left", "ctrl_shift_right",
            "shift_home", "shift_end"};

        for (int seed = firstSeed; seed < firstSeed + seeds; seed++) {
            Random rng = new Random(seed * 6364136223846793005L + 97);
            Ime ime = Robolectric.buildService(Ime.class).create().get();
            Host host = new Host(ime);
            ime.connection = host;
            // Exercise both normal editors and hostile editors (omitted bounds,
            // missing extraction/surrounding APIs, and delayed selection callbacks).
            host.omitBounds = (seed % 3 == 1);
            host.extractionUnavailable = (seed % 4 == 2);
            host.surroundingUnavailable = (seed % 4 == 2);
            host.deferSelections = (seed % 5 == 3);

            EditorInfo info = new EditorInfo();
            info.initialSelStart = info.initialSelEnd = 0;
            ime.onStartInput(info, false);
            ShadowLooper.idleMainLooper();
            switchToTelex(ime);
            ShadowLooper.idleMainLooper();

            ibusRpc(new JSONObject().put("op", "reset"));
            List<String> history = new ArrayList<>();
            boolean backspacedInPreedit = false;

            for (int step = 0; step < stepsPerSeed; step++) {
                int action = rng.nextInt(10);
                JSONObject oracleRes;
                if (action < 4) {
                    // Type a chunk of a word (maybe mid-word, maybe ending with Space/punct).
                    // Separate concatenations that hit known non-UX ibus-unikey quirks
                    // (`dd` spellcheck bypass, `quw` -> `quư`, resurrecting deleted vowel after BS).
                    String word = words[rng.nextInt(words.length)];
                    String curPre = host.preedit();
                    if (!curPre.isEmpty() && (backspacedInPreedit
                            || curPre.toLowerCase(Locale.ROOT).startsWith("đ")
                            || word.toLowerCase(Locale.ROOT).startsWith("dd")
                            || (curPre.toLowerCase(Locale.ROOT).equals("qu") && word.toLowerCase(Locale.ROOT).startsWith("w")))) {
                        word = " " + word;
                    }
                    backspacedInPreedit = false;
                    int take = rng.nextInt(3) == 0 ? 1 + rng.nextInt(word.length()) : word.length();
                    String chunk = word.substring(0, take);
                    if (take == word.length() && rng.nextBoolean()) chunk += rng.nextBoolean() ? " " : ".";
                    history.add("type(" + chunk + ")");
                    JSONArray batch = new JSONArray();
                    for (int i = 0; i < chunk.length(); i++) {
                        char ch = chunk.charAt(i);
                        sendAndroidKey(ime, host, ch);
                        if (host.deferSelections && rng.nextBoolean()) host.flushSelections();
                        batch.put(toIbusStep(ch));
                    }
                    JSONArray results = ibusRpc(new JSONObject().put("op", "batch").put("reset", false).put("steps", batch))
                            .getJSONArray("results");
                    oracleRes = results.getJSONObject(results.length() - 1);
                } else if (action == 4) {
                    // Backspace (either in-preedit, on selection, or in committed text).
                    // Avoid `dd` + BS leaving ibus-unikey's `dd` bypass flag stuck on an empty word.
                    if (host.preedit().toLowerCase(Locale.ROOT).equals("đ")) continue;
                    history.add("BS");
                    backspacedInPreedit = !host.preedit().isEmpty();
                    sendAndroidKey(ime, host, '\b');
                    oracleRes = ibusRpc(new JSONObject().put("op", "step").put("kind", "backspace"));
                } else if (action < 9) {
                    // Ctrl+A, Ctrl+Backspace, Arrows, Shift+Arrows, Ctrl+Shift+Arrows, Home/End, Forward Delete
                    backspacedInPreedit = false;
                    String op = navOps[rng.nextInt(navOps.length)];
                    boolean releaseFirst = rng.nextBoolean();
                    history.add(op + (releaseFirst ? "[modUpFirst]" : ""));
                    sendAndroidNavOrShortcut(ime, host, op, releaseFirst);
                    oracleRes = ibusRpc(new JSONObject().put("op", "step").put("kind", op));
                } else {
                    // Programmatic / touch tap or drag selection (only when selection actually changes,
                    // since EditText does not fire onUpdateSelection or end composition on a no-op tap).
                    backspacedInPreedit = false;
                    host.flushSelections();
                    int len = host.text().length();
                    int oldS = host.selStart(), oldE = host.selEnd();
                    int s = len == 0 ? 0 : rng.nextInt(len + 1);
                    int e = rng.nextBoolean() ? s : (len == 0 ? 0 : rng.nextInt(len + 1));
                    if (s == oldS && e == oldE && len > 0) {
                        s = (oldS == 0) ? len : 0;
                        e = s;
                    }
                    if (s == oldS && e == oldE) continue;
                    history.add("tap(" + s + "," + e + ")");
                    int cs = host.omitBounds ? -1 : BaseInputConnection.getComposingSpanStart(host.getEditable());
                    int ce = host.omitBounds ? -1 : BaseInputConnection.getComposingSpanEnd(host.getEditable());
                    Selection.setSelection(host.getEditable(), s, e);
                    ime.onUpdateSelection(oldS, oldE, s, e, cs, ce);
                    ShadowLooper.idleMainLooper();
                    oracleRes = ibusRpc(new JSONObject().put("op", "step").put("kind", "set_selection")
                            .put("start", s).put("end", e));
                }

                host.flushSelections();
                ShadowLooper.idleMainLooper();

                String ctx = "seed=" + seed + " step=" + step
                        + " (omit=" + host.omitBounds + ",noExt=" + host.extractionUnavailable
                        + ",defer=" + host.deferSelections + ") history=" + history;
                assertEquals("Text mismatch " + ctx, oracleRes.getString("text"), host.text());
                assertEquals("selStart mismatch " + ctx, oracleRes.getInt("selStart"), host.selStart());
                assertEquals("selEnd mismatch " + ctx, oracleRes.getInt("selEnd"), host.selEnd());
                assertEquals("preedit mismatch " + ctx, oracleRes.getString("preedit"), host.preedit());
            }
            ime.onDestroy();
        }
        System.out.println("Telex nav/selection/Ctrl+A/Ctrl+BS Robolectric fuzzing PASSED: "
                + seeds + " seeds x " + stepsPerSeed + " actions (0 discrepancies)");
    }
}
