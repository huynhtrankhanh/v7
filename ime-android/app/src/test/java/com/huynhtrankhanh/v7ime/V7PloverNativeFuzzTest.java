package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.text.Editable;
import android.text.Selection;
import android.view.KeyEvent;
import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.ExtractedText;
import android.view.inputmethod.ExtractedTextRequest;
import android.view.inputmethod.SurroundingText;
import android.widget.EditText;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.AfterClass;
import org.junit.Before;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowLooper;
import java.io.*;
import java.lang.reflect.Field;
import java.util.*;
import java.util.concurrent.Executor;
import static org.junit.Assert.*;

/** Real service, InputConnection and JS protocol; only external runtimes are shadowed. */
@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35, shadows = {
    V7PloverNativeFuzzTest.Sandbox.class,
    V7PloverNativeFuzzTest.Telex.class,
    V7PloverNativeFuzzTest.Inference.class,
    V7PloverNativeFuzzTest.Plover.class
})
@LooperMode(LooperMode.Mode.PAUSED)
public class V7PloverNativeFuzzTest {
    private static boolean variedPlover;
    private static int translations;
    private static int inferenceCalls;
    private static boolean rejectPlover;
    private static Host schedulingHost;
    private static Random schedulingRandom;
    private static boolean alternateCandidates;
    private static int responseSeed;
    private static boolean inlinePloverReset;
    private static boolean inlinePloverTranslate;
    private static boolean rejectPloverReset;
    private static int resets;
    private static String traceRun = "";
    private static boolean delayedWarmup;
    private static final List<Runnable> sandboxWarmups = new ArrayList<>();
    private static final List<JSONArray> ploverOutputs = new ArrayList<>();
    @Before public void resetExternalResponses() {
        ploverReplies.clear(); duplicateHardware = false; variedPlover = false;
        translations = 0; inferenceCalls = 0; rejectPlover = false;
        schedulingHost = null; schedulingRandom = null; alternateCandidates = false;
        responseSeed = 0; ploverOutputs.clear();
        inlinePloverReset = false;
        inlinePloverTranslate = false; rejectPloverReset = false; resets = 0;
        delayedWarmup = false; sandboxWarmups.clear(); traceRun = "";
    }
    public static class Ime extends V7ImeService {
        InputConnection connection;
        @Override public InputConnection getCurrentInputConnection() { return connection; }
    }
    private static Process node;
    private static BufferedReader input;
    private static PrintWriter output;
    private static int sessionSequence;
    private static synchronized JSONObject rpc(JSONObject call) throws Exception {
        if (node == null) {
            File rootDirectory = new File(System.getProperty("v7.test.root", ".")).getCanonicalFile();
            while (rootDirectory != null && !new File(rootDirectory, "scripts/native-ime-fuzz-host.cjs").isFile())
                rootDirectory = rootDirectory.getParentFile();
            if (rootDirectory == null) throw new IOException("Cannot locate native-ime-fuzz-host.cjs");
            String root = rootDirectory.getPath();
            node = new ProcessBuilder("node", root + "/scripts/native-ime-fuzz-host.cjs")
                    .redirectError(ProcessBuilder.Redirect.INHERIT).start();
            input = new BufferedReader(new InputStreamReader(node.getInputStream()));
            output = new PrintWriter(node.getOutputStream(), true);
        }
        output.println(call);
        String line = input.readLine();
        if (line == null) throw new IOException("Node protocol host stopped");
        JSONObject packet = new JSONObject(line);
        if (packet.has("hostError")) throw new IOException(packet.getString("hostError"));
        return packet;
    }
    @AfterClass public static void stopNode() {
        if (node != null) node.destroyForcibly();
        node = null;
    }
    @Implements(value = ImeJavaScriptSandbox.class, isInAndroidSdk = false)
    public static class Sandbox {
        private final int session = ++sessionSequence;
        private boolean ready;
        private boolean warming;
        private long generation;
        @Implementation protected void warmAsync(Executor executor, Runnable changed) {
            if (ready || warming) return;
            warming = true; long owner = generation;
            Runnable complete = () -> {
                if (owner != generation) return;
                warming = false; ready = true; changed.run();
            };
            if (delayedWarmup) sandboxWarmups.add(complete); else complete.run();
        }
        @Implementation protected boolean isReady() { return ready; }
        @Implementation protected long generation() { return generation; }
        @Implementation protected JSONObject dispatch(JSONObject command) throws Exception {
            return rpc(new JSONObject().put("session", session).put("command", command));
        }
        @Implementation protected JSONObject reply(int id, String value, String error) throws Exception {
            return rpc(new JSONObject().put("session", session).put("id", id)
                    .put("value", "null".equals(value) ? JSONObject.NULL : new JSONObject(value)).put("error", error));
        }
        @Implementation protected void close() {
            ready = false; warming = false; generation++;
            try { rpc(new JSONObject().put("session", session).put("close", true)); }
            catch (Exception e) { throw new AssertionError(e); }
        }
    }
    @Implements(value = TelexJavaScriptSandbox.class, isInAndroidSdk = false)
    public static class Telex {
        private boolean ready;
        @Implementation protected void warmAsync(Executor executor, Runnable changed) { ready = true; changed.run(); }
        @Implementation protected boolean isReady() { return ready; }
        @Implementation protected String convertIfReady(String raw) {
            if (!ready) return null;
            try { return rpc(new JSONObject().put("telex", raw)).getString("text"); }
            catch (Exception e) { throw new AssertionError(e); }
        }
        @Implementation protected void close() { ready = false; }
    }
    @Implements(value = NativeInference.class, isInAndroidSdk = false)
    public static class Inference {
        @Implementation protected static String infer(Context context, String body) throws Exception {
            inferenceCalls++;
            JSONArray islands = new JSONObject(body).getJSONArray("islands");
            JSONArray parts = new JSONArray();
            JSONArray alternate = new JSONArray();
            for (int i = 0; i < islands.length(); i++) {
                JSONObject island = islands.getJSONObject(i);
                String decoded;
                if ("fixed".equals(island.getString("kind"))) decoded = island.getString("text");
                else switch (island.getString("code")) {
                    case "su3du5": decoded = "sử dụng"; break;
                    case "ti1na0": decoded = "tính năng"; break;
                    case "cho0phe6": decoded = "cho phép"; break;
                    default: decoded = "chính thức";
                }
                parts.put(decoded);
                alternate.put("fixed".equals(island.getString("kind")) ? decoded : "mở rộng");
            }
            JSONArray candidates = new JSONArray().put(parts);
            if (alternateCandidates) candidates.put(alternate);
            return new JSONObject().put("candidates", candidates).toString();
        }
    }
    private static final List<Runnable> ploverReplies = new ArrayList<>();
    @Implements(value = BundledStrippedPloverRuntime.class, isInAndroidSdk = false)
    public static class Plover {
        @Implementation protected void request(String body, BundledStrippedPloverRuntime.Callback callback) {
            try {
                JSONObject request = new JSONObject(body);
                JSONArray text = new JSONArray();
                boolean translate = "translate".equals(request.getString("method"));
                if (translate) {
                    int sequence = translations++;
                    if (!variedPlover) text.put(new JSONObject().put("type", "preedit").put("text", "video"));
                    else switch (sequence % 9) {
                        case 0: text.put(new JSONObject().put("type", "preedit").put("text", sequence < 9 ? "v" : variedPreedit(sequence))); break;
                        case 1: text.put(new JSONObject().put("type", "preedit").put("text", "video playback grows much longer".repeat(sequence < 9 ? 1 : 1+Math.floorMod(responseSeed+sequence*13, 7)))); break;
                        case 2: text.put(new JSONObject().put("type", "preedit").put("text", sequence < 9 ? "vid" : variedPreedit(sequence))); break;
                        case 3: text.put(new JSONObject().put("type", "preedit").put("text", "")); break;
                        case 4: text.put(new JSONObject().put("type", "preedit").put("text", "🙂 tiếng Việt\n中 e\u0301".repeat(sequence < 9 ? 1 : 1+Math.floorMod(responseSeed+sequence, 5)))); break;
                        case 5:
                            text.put(new JSONObject().put("type", "committed").put("text", "committed "));
                            text.put(new JSONObject().put("type", "preedit").put("text", "next")); break;
                        case 6: text.put(new JSONObject().put("type", "preedit").put("text", "replacement with no shared prefix".repeat(sequence < 9 ? 1 : 1+Math.floorMod(responseSeed*3+sequence, 3)))); break;
                        case 7: text.put(new JSONObject().put("type", "committed").put("text", "done")); break;
                        case 8: break; // An empty output retracts the current preedit.
                    }
                }
                if (translate) ploverOutputs.add(text);
                String response = new JSONObject().put("result", new JSONObject().put("output", text)).toString();
                boolean resetFailure = !translate && request.optInt("id") != 0
                        && rejectPloverReset && ++resets % 5 == 1;
                boolean fail = resetFailure || (rejectPlover && translate && translations % 7 == 0);
                Runnable reply = () -> callback.onResult(fail ? "" : response, fail ? "Injected Plover failure" : "");
                if (translate ? inlinePloverTranslate : inlinePloverReset) reply.run(); else ploverReplies.add(reply);
            } catch (Exception e) { throw new AssertionError(e); }
        }
    }
    private static String variedPreedit(int sequence) {
        Random random = new Random(((long) responseSeed << 32) ^ sequence);
        String[] alphabet = {"a", "đ", "ế", "中", "🙂", "e\u0301", " ", "\n", "\t", ".", "'", "Ω"};
        StringBuilder result = new StringBuilder();
        int tokens = random.nextInt(257);
        for (int i = 0; i < tokens; i++) result.append(alphabet[random.nextInt(alphabet.length)]);
        return result.toString();
    }
    private static class Host extends BaseInputConnection {
        final Ime ime;
        final EditText editor;
        final List<Runnable> selections = new ArrayList<>();
        boolean omitBounds;
        boolean reentrant;
        boolean partialExtraction;
        boolean extractionUnavailable;
        boolean surroundingUnavailable;
        boolean staleExtraction;
        String cachedText;
        int cachedCaret;
        int rejectedWrites;
        int rejectedFinishes;
        final List<String> published = new ArrayList<>();
        @Override public boolean sendKeyEvent(KeyEvent event) {
            assertFalse("Printable hardware key leaked to the host", event.getKeyCode() >= KeyEvent.KEYCODE_A
                    && event.getKeyCode() <= KeyEvent.KEYCODE_Z);
            if (event.getKeyCode() == KeyEvent.KEYCODE_ENTER && event.getAction() == KeyEvent.ACTION_DOWN) {
                int start = Selection.getSelectionStart(getEditable()), end = Selection.getSelectionEnd(getEditable());
                super.finishComposingText();
                getEditable().replace(Math.min(start, end), Math.max(start, end), "\n");
                int caret = Math.min(start, end) + 1;
                Selection.setSelection(getEditable(), caret);
                ime.onUpdateSelection(start, end, caret, caret, -1, -1);
            }
            return true;
        }
        Host(Ime ime) { this(ime, "prefix "); }
        Host(Ime ime, String prefix) {
            super(new EditText(ime), true); this.ime = ime; editor = new EditText(ime);
            editor.setText(prefix); Selection.setSelection(editor.getText(), editor.length());
        }
        @Override public Editable getEditable() { return editor.getText(); }
        @Override public ExtractedText getExtractedText(ExtractedTextRequest request, int flags) {
            if (extractionUnavailable) return null;
            ExtractedText text = new ExtractedText();
            if (staleExtraction && cachedText != null) {
                text.text = cachedText; text.startOffset = 0;
                text.selectionStart = text.selectionEnd = cachedCaret;
                return text;
            }
            int offset = partialExtraction ? Math.max(0, Math.min(Selection.getSelectionStart(getEditable()),
                    Selection.getSelectionEnd(getEditable())) - 1) : 0;
            text.text = getEditable().subSequence(offset, getEditable().length()); text.startOffset = offset;
            text.selectionStart = Selection.getSelectionStart(getEditable()) - offset;
            text.selectionEnd = Selection.getSelectionEnd(getEditable()) - offset;
            if (Boolean.getBoolean("v7.trace") && !traceRun.isEmpty()) {
                try { System.err.println(traceRun+" QUERY offset="+offset+" rel="+text.selectionStart+":"+text.selectionEnd+" origin="+field(ime,"preeditStart")+" preedit="+field(ime,"preeditText")); }
                catch (Exception e) { throw new AssertionError(e); }
            }
            return text;
        }
        @Override public SurroundingText getSurroundingText(int before, int after, int flags) {
            return surroundingUnavailable ? null : super.getSurroundingText(before, after, flags);
        }
        @Override public boolean setComposingText(CharSequence text, int position) {
            published.add(text.toString());
            if (rejectedWrites > 0) { rejectedWrites--; return false; }
            int old = Selection.getSelectionStart(getEditable());
            boolean result = super.setComposingText(text, position);
            recordSelection(old, text.toString());
            return result;
        }
        @Override public boolean commitText(CharSequence text, int position) {
            int old = Selection.getSelectionStart(getEditable());
            boolean result = super.commitText(text, position);
            recordSelection(old, "commit:"+text);
            return result;
        }
        @Override public boolean finishComposingText() {
            if (rejectedFinishes > 0) { rejectedFinishes--; return false; }
            int old = Selection.getSelectionStart(getEditable());
            boolean result = super.finishComposingText();
            recordSelection(old, "finish");
            return result;
        }
        private void recordSelection(int old, String text) {
            int end = Selection.getSelectionStart(getEditable());
            if (staleExtraction && text.contains("[0a00a0]")) {
                cachedText = getEditable().toString(); cachedCaret = end;
            }
            int a = omitBounds ? -1 : getComposingSpanStart(getEditable());
            int z = omitBounds ? -1 : getComposingSpanEnd(getEditable());
            String publishedOrigin;
            try { publishedOrigin = " writeOrigin="+field(ime, "preeditStart")+" writePreedit="+field(ime, "preeditText"); }
            catch (Exception e) { throw new AssertionError(e); }
            if (Boolean.getBoolean("v7.trace") && !traceRun.isEmpty()) System.err.println(traceRun+" WRITE old="+old+" new="+end+publishedOrigin+" text="+text);
            Runnable callback = () -> {
                try {
                    int before = epoch(ime);
                    String origin = " origin="+field(ime, "preeditStart")+" preedit="+field(ime, "preeditText")
                            +" live="+Selection.getSelectionStart(getEditable());
                    ime.onUpdateSelection(old, old, end, end, a, z);
                    assertEquals("Own callback reset session old="+old+" new="+end+" bounds="+a+":"+z
                            +" callback text="+text+" editor="+getEditable()+origin+publishedOrigin, before, epoch(ime));
                } catch (Exception e) { throw new AssertionError(e); }
            };
            if (reentrant) callback.run();
            selections.add(callback);
        }
    }
    private static int epoch(Ime ime) throws Exception {
        Field field = V7ImeService.class.getDeclaredField("inputGeneration"); field.setAccessible(true);
        return ((java.util.concurrent.atomic.AtomicInteger) field.get(ime)).get();
    }
    private static long time;
    private static void chord(Ime ime, int... keys) {
        for (int code : keys) assertTrue(ime.onKeyDown(code, new KeyEvent(0, ++time, KeyEvent.ACTION_DOWN, code, 0)));
        for (int code : keys) assertTrue(ime.onKeyUp(code, new KeyEvent(0, ++time, KeyEvent.ACTION_UP, code, 0)));
    }
    private static boolean duplicateHardware;
    private static void hardware(Ime ime, int action, int code, int modifiers) {
        KeyEvent event = new KeyEvent(0, ++time, action, code, 0, modifiers);
        boolean handled = action == KeyEvent.ACTION_DOWN ? ime.onKeyDown(code, event) : ime.onKeyUp(code, event);
        assertTrue("key="+code+" action="+action, handled);
        if (duplicateHardware) {
            if (action == KeyEvent.ACTION_DOWN) assertTrue(ime.onKeyDown(code, event));
            else assertTrue(ime.onKeyUp(code, event));
        }
        if (schedulingHost != null) {
            if (!schedulingHost.selections.isEmpty() && schedulingRandom.nextInt(4) == 0)
                schedulingHost.selections.remove(schedulingRandom.nextInt(schedulingHost.selections.size())).run();
            if (!ploverReplies.isEmpty() && schedulingRandom.nextInt(5) == 0)
                ploverReplies.remove(schedulingRandom.nextInt(ploverReplies.size())).run();
        }
    }
    private static void input(Ime ime, boolean caps, int... codes) {
        int modifiers = caps ? KeyEvent.META_CAPS_LOCK_ON : 0;
        for (int code : codes) hardware(ime, KeyEvent.ACTION_DOWN, code, modifiers);
        List<Integer> release = new ArrayList<>(); for (int code : codes) release.add(code);
        if (schedulingRandom != null) Collections.shuffle(release, schedulingRandom);
        for (int code : release) hardware(ime, KeyEvent.ACTION_UP, code, modifiers);
    }
    private static class Part {
        final String text;
        final boolean capital;
        Part(String text, boolean capital) { this.text = text; this.capital = capital; }
    }
    private static String render(List<Part> parts) {
        StringBuilder text = new StringBuilder("prefix ");
        for (int i = 0; i < parts.size(); i++) {
            if (i > 0 && !(parts.get(i - 1).capital && parts.get(i).capital)) text.append(' ');
            text.append(parts.get(i).text);
        }
        return text.toString();
    }
    @Test public void fuzzModeSwitchesAndEditorAcknowledgements() throws Exception {
        requireScenario("basic");
        int seeds = Integer.getInteger("v7.fuzz.seeds", 100);
        int steps = Integer.getInteger("v7.fuzz.steps", 100);
        int firstSeed = Integer.getInteger("v7.fuzz.firstSeed", 0);
        for (int seed = firstSeed; seed < firstSeed + seeds; seed++) {
            Random random = new Random(seed);
            ploverReplies.clear();
            Ime ime = Robolectric.buildService(Ime.class).create().get();
            Host host = new Host(ime); ime.connection = host;
            host.extractionUnavailable = seed % 7 == 0;
            android.view.inputmethod.EditorInfo info = new android.view.inputmethod.EditorInfo();
            info.initialSelStart = info.initialSelEnd = host.editor.length();
            ime.onStartInput(info, false);
            ShadowLooper.idleMainLooper();
            int generation = epoch(ime);
            boolean plover = false;
            String preedit = null;
            List<Part> fixed = new ArrayList<>();
            List<String> history = new ArrayList<>();
            for (int step = 0; step < steps; step++) {
                int action = random.nextInt(5);
                boolean caps = random.nextBoolean();
                history.add(action+(caps ? "U" : "L"));
                duplicateHardware = random.nextBoolean();
                host.omitBounds = random.nextBoolean();
                host.partialExtraction = random.nextBoolean();
                host.reentrant = random.nextInt(5) == 0;
                int modifiers = caps ? KeyEvent.META_CAPS_LOCK_ON : 0;
                if (action == 0) {
                    input(ime, caps, KeyEvent.KEYCODE_Q);
                    if (plover && preedit != null) { fixed.add(new Part(preedit, false)); preedit = null; }
                    plover = !plover;
                } else {
                    if (action == 1) input(ime, caps, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
                    else if (action == 2) input(ime, caps, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C);
                    else if (action == 3) {
                        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_SHIFT_LEFT, modifiers | KeyEvent.META_SHIFT_ON);
                        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A, modifiers | KeyEvent.META_SHIFT_ON);
                        hardware(ime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_A, modifiers | KeyEvent.META_SHIFT_ON);
                        hardware(ime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SHIFT_LEFT, modifiers);
                    } else input(ime, caps, KeyEvent.KEYCODE_7);
                    if (plover) {
                        // Numeric row keys have no assigned Plover chord in this layout.
                        if (action != 4) preedit = caps ? "VIDEO" : "video";
                    } else {
                        String text = action == 1 ? "chính thức" : action == 2 ? "ta" : action == 3 ? "A" : "7";
                        fixed.add(new Part(caps ? text.toUpperCase(Locale.forLanguageTag("vi")) : text, action >= 3));
                    }
                }
                if (!host.selections.isEmpty() && random.nextBoolean()) {
                    Runnable callback = host.selections.remove(random.nextInt(host.selections.size()));
                    callback.run();
                    if (random.nextBoolean()) callback.run();
                }
                if (!ploverReplies.isEmpty() && random.nextBoolean())
                    ploverReplies.remove(random.nextInt(ploverReplies.size())).run();
                if (random.nextInt(5) == 0) ShadowLooper.idleMainLooper();
                assertEquals("seed="+seed+" steps="+history+" IME-owned callbacks cleared the session", generation, epoch(ime));
            }
            for (int count = 0; count < steps * 30 && (!ploverReplies.isEmpty() || !host.selections.isEmpty()); count++) {
                if (!ploverReplies.isEmpty()) ploverReplies.remove(random.nextInt(ploverReplies.size())).run();
                if (!host.selections.isEmpty()) {
                    Runnable callback = host.selections.remove(random.nextInt(host.selections.size()));
                    callback.run();
                    if (random.nextBoolean()) callback.run();
                }
                assertEquals("seed="+seed+" drain="+count+" IME-owned callbacks cleared the session", generation, epoch(ime));
            }
            assertTrue("seed="+seed+" Plover did not drain", ploverReplies.isEmpty());
            List<Part> expected = new ArrayList<>(fixed);
            if (preedit != null) expected.add(new Part(preedit, false));
            assertEquals("seed="+seed+" steps="+history, render(expected), host.editor.getText().toString());
            JSONObject snapshot = new JSONObject((String) field(ime, "inputSnapshot"));
            assertEquals("seed="+seed+" final mode", plover, snapshot.getBoolean("ploverEnabled"));
            ime.onDestroy();
            if ((seed - firstSeed + 1) % 25 == 0)
                System.out.println("Native fuzz: " + (seed - firstSeed + 1) + " seeds x " + steps + " steps passed");
        }
    }
    private static Object field(Ime ime, String name) throws Exception {
        Field field = V7ImeService.class.getDeclaredField(name); field.setAccessible(true); return field.get(ime);
    }
    private static void command(Ime ime, String type, int index) throws Exception {
        java.lang.reflect.Method method = V7ImeService.class.getDeclaredMethod("dispatchInputCommand", JSONObject.class);
        method.setAccessible(true);
        method.invoke(ime, new JSONObject().put("type", type).put("index", index).put("epoch", epoch(ime)));
    }
    private static void settle(Host host, Random timing, boolean hostile) throws Exception {
        for (int turn = 0; turn < 20000; turn++) {
            if (ploverReplies.isEmpty() && host.selections.isEmpty()) {
                ShadowLooper.idleMainLooper();
                if (ploverReplies.isEmpty() && host.selections.isEmpty()) return;
            }
            if (!host.selections.isEmpty() && (ploverReplies.isEmpty() || timing.nextBoolean())) {
                int at = hostile ? timing.nextInt(host.selections.size()) : 0;
                Runnable callback = host.selections.remove(at); callback.run();
                if (hostile && timing.nextBoolean()) callback.run();
            } else if (!ploverReplies.isEmpty()) {
                int at = hostile ? timing.nextInt(ploverReplies.size()) : 0;
                Runnable callback = ploverReplies.remove(at); callback.run();
                if (hostile && timing.nextInt(5) == 0) callback.run();
            }
        }
        fail("Native input did not settle: replies="+ploverReplies.size()+" selections="+host.selections.size());
    }
    private static android.view.inputmethod.EditorInfo editorInfo(Host host) {
        android.view.inputmethod.EditorInfo info = new android.view.inputmethod.EditorInfo();
        info.initialSelStart = Selection.getSelectionStart(host.getEditable());
        info.initialSelEnd = Selection.getSelectionEnd(host.getEditable());
        return info;
    }
    private static void modifiers(Ime ime, boolean telex) {
        ime.onKeyDown(KeyEvent.KEYCODE_CTRL_LEFT, new KeyEvent(0, ++time, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_CTRL_LEFT, 0, KeyEvent.META_CTRL_ON));
        int key = telex ? KeyEvent.KEYCODE_TAB : KeyEvent.KEYCODE_SHIFT_LEFT;
        int flags = KeyEvent.META_CTRL_ON | (telex ? 0 : KeyEvent.META_SHIFT_ON);
        ime.onKeyDown(key, new KeyEvent(0, ++time, KeyEvent.ACTION_DOWN, key, 0, flags));
        ime.onKeyUp(key, new KeyEvent(0, ++time, KeyEvent.ACTION_UP, key, 0, KeyEvent.META_CTRL_ON));
        ime.onKeyUp(KeyEvent.KEYCODE_CTRL_LEFT, new KeyEvent(0, ++time, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_CTRL_LEFT, 0));
    }
    private static List<String> runScenario(int seed, int steps, boolean hostile, boolean sustainedPlover) throws Exception {
        ploverReplies.clear(); duplicateHardware = false; translations = 0; inferenceCalls = 0;
        variedPlover = true; rejectPlover = seed % 3 == 0; alternateCandidates = true; responseSeed = seed;
        resets = 0; rejectPloverReset = seed % 3 == 1;
        inlinePloverReset = hostile && seed % 4 < 2;
        inlinePloverTranslate = hostile && seed % 4 == 1;
        ploverOutputs.clear();
        Random actions = new Random(seed), timing = new Random(seed ^ 0x5deece66dL);
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime, "prefix 🙂 "); ime.connection = host;
        ime.onStartInput(editorInfo(host), false); ShadowLooper.idleMainLooper();
        host.extractionUnavailable = hostile && seed % 7 == 0;
        host.staleExtraction = hostile && seed % 13 == 0;
        if (sustainedPlover && hostile && seed % 11 == 0) {
            host.extractionUnavailable = true; host.surroundingUnavailable = true;
        }
        // Every scenario starts with a V7 island; sustained runs enter Plover
        // once and never toggle again while that island is repeatedly inferred.
        boolean withV7 = !sustainedPlover || seed % 2 == 0;
        if (withV7) input(ime, false, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        settle(host, timing, hostile);
        if (sustainedPlover) { input(ime, false, KeyEvent.KEYCODE_Q); settle(host, timing, hostile); }
        List<String> result = new ArrayList<>(), history = new ArrayList<>();
        traceRun = "seed="+seed+" hostile="+hostile+" sustained="+sustainedPlover;
        if (hostile) { schedulingHost = host; schedulingRandom = timing; }
        try {
            for (int step = 0; step < steps; step++) {
                int action = sustainedPlover ? 1 + actions.nextInt(8) : actions.nextInt(27);
                boolean caps = actions.nextBoolean(); history.add(action+(caps ? "U" : "L"));
                if (Boolean.getBoolean("v7.trace")) System.err.println(traceRun+" STEP "+step+" action="+action+" caps="+caps);
                // Explicit commits/cursor moves operate on settled text; view
                // resets intentionally occur while completed input is queued.
                boolean boundary = action >= 9 && action != 14 && action != 24;
                if (boundary) settle(host, timing, hostile);
                int generation = epoch(ime);
                host.omitBounds = hostile && timing.nextBoolean();
                host.partialExtraction = hostile && timing.nextBoolean();
                host.reentrant = hostile && timing.nextInt(3) == 0;
                duplicateHardware = hostile && timing.nextBoolean();
                switch (action) {
                    case 0: input(ime, caps, KeyEvent.KEYCODE_Q); break;
                    case 1: input(ime, caps, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M); break;
                    case 2: input(ime, caps, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C); break;
                    case 3:
                        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A, KeyEvent.META_SHIFT_ON | (caps ? KeyEvent.META_CAPS_LOCK_ON : 0));
                        hardware(ime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_A, KeyEvent.META_SHIFT_ON | (caps ? KeyEvent.META_CAPS_LOCK_ON : 0)); break;
                    case 4: input(ime, caps, KeyEvent.KEYCODE_7); break;
                    case 5: input(ime, caps, KeyEvent.KEYCODE_SPACE); break;
                    case 6: input(ime, caps, KeyEvent.KEYCODE_A, KeyEvent.KEYCODE_I); break; // S-P spacing.
                    case 7: input(ime, caps, KeyEvent.KEYCODE_A, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_S, KeyEvent.KEYCODE_R,
                            KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_V, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_U,
                            KeyEvent.KEYCODE_J, KeyEvent.KEYCODE_O, KeyEvent.KEYCODE_L, KeyEvent.KEYCODE_G); break;
                    case 8: input(ime, caps, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_E, KeyEvent.KEYCODE_I, KeyEvent.KEYCODE_O); break; // TP-PL punctuation.
                    case 9: paste(ime, 0, " literal 🙂\nΩ "); break;
                    case 10: command(ime, "select", caps ? 1 : 0); break;
                    case 11: input(ime, caps, KeyEvent.KEYCODE_LEFT_BRACKET); break;
                    case 12: input(ime, caps, KeyEvent.KEYCODE_APOSTROPHE); break;
                    case 13: ime.onStartInput(editorInfo(host), true); break;
                    case 14:
                        ime.onFinishInputView(false); ime.onStartInputView(editorInfo(host), false); break;
                    case 15: {
                        int old = Selection.getSelectionStart(host.getEditable());
                        int moved = Math.max(0, host.editor.length() - 2);
                        Selection.setSelection(host.getEditable(), moved);
                        ime.onUpdateSelection(old, old, moved, moved, -1, -1); break;
                    }
                    case 16:
                        modifiers(ime, false); modifiers(ime, false); break;
                    case 17:
                        host.rejectedWrites = 1;
                        input(ime, caps, KeyEvent.KEYCODE_7);
                        command(ime, "refresh", 0); break;
                    case 18:
                        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_W, 0);
                        ime.onFinishInputView(false); ime.onStartInputView(editorInfo(host), false);
                        hardware(ime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_W, 0); break;
                    case 19: modifiers(ime, true); modifiers(ime, true); break;
                    case 20:
                        input(ime, caps, KeyEvent.KEYCODE_ENTER); break;
                    case 21:
                        ime.onFinishInput(); ime.onStartInput(editorInfo(host), false); break;
                    case 22:
                        modifiers(ime, true);
                        input(ime, false, KeyEvent.KEYCODE_T); input(ime, false, KeyEvent.KEYCODE_I);
                        input(ime, false, KeyEvent.KEYCODE_E); input(ime, false, KeyEvent.KEYCODE_E);
                        input(ime, false, KeyEvent.KEYCODE_N); input(ime, false, KeyEvent.KEYCODE_G);
                        input(ime, false, KeyEvent.KEYCODE_S); input(ime, false, KeyEvent.KEYCODE_SPACE);
                        modifiers(ime, true); break;
                    case 23:
                        host.rejectedFinishes = 1;
                        input(ime, caps, KeyEvent.KEYCODE_SPACE); break;
                    case 24:
                        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A, KeyEvent.META_SHIFT_ON);
                        ime.onFinishInputView(false); ime.onStartInputView(editorInfo(host), false);
                        hardware(ime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_A, KeyEvent.META_SHIFT_ON); break;
                    case 25:
                        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_C, 0);
                        assertTrue(ime.onKeyDown(KeyEvent.KEYCODE_C, new KeyEvent(0, ++time, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_C, 1)));
                        hardware(ime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_C, 0); break;
                    case 26: input(ime, caps, KeyEvent.KEYCODE_NUMPAD_7); break;
                    default: throw new AssertionError(action);
                }
                if (action < 9 || action == 14 || action == 17 || action == 18)
                    assertEquals("Unexpected session reset seed="+seed+" actions="+history, generation, epoch(ime));
                if (!hostile) settle(host, timing, false);
                else {
                    if (!host.selections.isEmpty() && timing.nextBoolean()) host.selections.remove(timing.nextInt(host.selections.size())).run();
                    if (!ploverReplies.isEmpty() && timing.nextInt(3) == 0) ploverReplies.remove(timing.nextInt(ploverReplies.size())).run();
                }
                // Compare at fixed checkpoints, without extra physical input to
                // unstick progress. Use the same semantic checkpoints in both runs.
                if (step % 12 == 11 || boundary || step == steps - 1) {
                    settle(host, timing, hostile); command(ime, "refresh", 0); settle(host, timing, hostile);
                    JSONObject snapshot = new JSONObject((String) field(ime, "inputSnapshot"));
                    assertFalse("Raw V7 persisted seed="+seed+" actions="+history, snapshot.getString("text").contains("[0a00a0]"));
                    result.add(history+"\n"+host.editor.getText().toString()+"|"+snapshot.getString("text")+"|"+snapshot.getBoolean("ploverEnabled")+"|"+epoch(ime));
                }
            }
            if (sustainedPlover && withV7) assertTrue("Sustained Plover must keep exercising inference", inferenceCalls > 1);
            return result;
        } catch (Throwable error) {
            throw new AssertionError("seed="+seed+" hostile="+hostile+" sustained="+sustainedPlover+" actions="+history, error);
        } finally { traceRun = ""; schedulingHost = null; schedulingRandom = null; ime.onDestroy(); }
    }
    @Test public void fuzzEditingAndLifecycleAgainstImmediateExecution() throws Exception {
        requireScenario("lifecycle");
        int seeds = Integer.getInteger("v7.fuzz.seeds", 100), steps = Integer.getInteger("v7.fuzz.steps", 100);
        int first = Integer.getInteger("v7.fuzz.firstSeed", 0);
        for (int seed = first; seed < first + seeds; seed++) {
            compareScenarios(seed, steps, false);
            if ((seed-first+1)%25 == 0) System.out.println("Lifecycle fuzz: "+(seed-first+1)+" seeds x "+steps+" steps passed twice");
        }
    }
    @Test public void fuzzSustainedVariedPloverOverV7AgainstImmediateExecution() throws Exception {
        requireScenario("plover");
        int seeds = Integer.getInteger("v7.fuzz.seeds", 100), steps = Integer.getInteger("v7.fuzz.steps", 100);
        int first = Integer.getInteger("v7.fuzz.firstSeed", 0);
        for (int seed = first; seed < first + seeds; seed++) {
            compareScenarios(seed, steps, true);
            if ((seed-first+1)%25 == 0) System.out.println("Sustained Plover fuzz: "+(seed-first+1)+" seeds x "+steps+" steps passed twice");
        }
    }
    private static void compareScenarios(int seed, int steps, boolean sustained) throws Exception {
        List<String> immediate = runScenario(seed, steps, false, sustained);
        List<String> delayed = runScenario(seed, steps, true, sustained);
        assertEquals("checkpoint count", immediate.size(), delayed.size());
        for (int checkpoint = 0; checkpoint < immediate.size(); checkpoint++)
            if (!immediate.get(checkpoint).equals(delayed.get(checkpoint)))
                fail("Timing changed result seed="+seed+" sustained="+sustained+" checkpoint="+checkpoint
                        +"\nexpected="+JSONObject.quote(immediate.get(checkpoint))+"\nactual="+JSONObject.quote(delayed.get(checkpoint)));
    }
    private static void requireScenario(String scenario) {
        String selected = System.getProperty("v7.fuzz.scenario", "all");
        org.junit.Assume.assumeTrue("Scenario disabled: "+scenario, "all".equals(selected) || scenario.equals(selected));
    }
    private static void paste(Ime ime, int slot, String value) {
        new ClipboardSlotStore(ime).set(slot, value);
        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_CTRL_LEFT, KeyEvent.META_CTRL_ON);
        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_0 + slot, KeyEvent.META_CTRL_ON);
        hardware(ime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_CTRL_LEFT, 0);
        hardware(ime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_0 + slot, 0);
    }
    @Test public void recordedDictionarySegmentSurvivesPloverExitAndNativeCallbacks() throws Exception {
        ploverReplies.clear(); duplicateHardware = true;
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        String prefix = "Tháng 6 vừa qua, YouTube ";
        Host host = new Host(ime, prefix); ime.connection = host;
        ShadowLooper.idleMainLooper();
        host.omitBounds = true; host.reentrant = true;
        chord(ime, KeyEvent.KEYCODE_A, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_S, KeyEvent.KEYCODE_R,
                KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_V, KeyEvent.KEYCODE_SPACE,
                KeyEvent.KEYCODE_U, KeyEvent.KEYCODE_J, KeyEvent.KEYCODE_O, KeyEvent.KEYCODE_L, KeyEvent.KEYCODE_G);
        paste(ime, 0, " đưa vào ");
        chord(ime, KeyEvent.KEYCODE_A, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_E, KeyEvent.KEYCODE_F,
                KeyEvent.KEYCODE_V, KeyEvent.KEYCODE_N, KeyEvent.KEYCODE_U, KeyEvent.KEYCODE_J,
                KeyEvent.KEYCODE_I, KeyEvent.KEYCODE_K, KeyEvent.KEYCODE_O, KeyEvent.KEYCODE_P,
                KeyEvent.KEYCODE_G, KeyEvent.KEYCODE_H);
        chord(ime, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_S, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_V,
                KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M, KeyEvent.KEYCODE_U, KeyEvent.KEYCODE_I,
                KeyEvent.KEYCODE_O, KeyEvent.KEYCODE_G, KeyEvent.KEYCODE_H);
        chord(ime, KeyEvent.KEYCODE_A, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_R, KeyEvent.KEYCODE_V,
                KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_J, KeyEvent.KEYCODE_I, KeyEvent.KEYCODE_O,
                KeyEvent.KEYCODE_L, KeyEvent.KEYCODE_G, KeyEvent.KEYCODE_H);
        paste(ime, 1, " phát ");
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_Q);
        chord(ime, KeyEvent.KEYCODE_A); // The video translation stays pending.
        chord(ime, KeyEvent.KEYCODE_Q);
        chord(ime, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C);
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        Collections.reverse(host.selections);
        while (!host.selections.isEmpty()) { Runnable callback = host.selections.remove(0); callback.run(); callback.run(); }
        assertEquals(generation, epoch(ime));
        assertEquals(prefix+"chính thức đưa vào sử dụng tính năng cho phép phát video ta", host.editor.getText().toString());
        assertFalse(new JSONObject((String) field(ime, "inputSnapshot")).getBoolean("ploverEnabled"));
        assertTrue(host.published.stream().anyMatch(text -> text.contains("[D: chi1thu6]") && text.contains("[D: cho0phe6]")));
        ime.onDestroy();
    }
    @Test public void reentrantRawPublicationCallbackCannotInvalidateItsInferenceReply() throws Exception {
        ploverReplies.clear();
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        host.omitBounds = true;
        host.reentrant = true;
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        chord(ime, KeyEvent.KEYCODE_Q);
        chord(ime, KeyEvent.KEYCODE_A);
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        chord(ime, KeyEvent.KEYCODE_Q);
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        assertEquals(generation, epoch(ime));
        assertEquals("prefix chính thức video", host.editor.getText().toString());
        assertTrue(host.published.contains("[0a00a0] video"));
        ime.onDestroy();
    }
    @Test public void queuedPloverExitUsesV7RulesForShiftedLettersAndDigits() throws Exception {
        ploverReplies.clear();
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_Q); // Enter Plover.
        chord(ime, KeyEvent.KEYCODE_A); // Translation deliberately left pending.
        chord(ime, KeyEvent.KEYCODE_Q); // Exit queued behind that translation.
        ime.onKeyDown(KeyEvent.KEYCODE_SHIFT_LEFT, new KeyEvent(0, ++time,
                KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_SHIFT_LEFT, 0, KeyEvent.META_SHIFT_ON));
        ime.onKeyDown(KeyEvent.KEYCODE_A, new KeyEvent(0, ++time,
                KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A, 0, KeyEvent.META_SHIFT_ON));
        ime.onKeyUp(KeyEvent.KEYCODE_A, new KeyEvent(0, ++time,
                KeyEvent.ACTION_UP, KeyEvent.KEYCODE_A, 0, KeyEvent.META_SHIFT_ON));
        ime.onKeyUp(KeyEvent.KEYCODE_SHIFT_LEFT, new KeyEvent(0, ++time,
                KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SHIFT_LEFT, 0));
        chord(ime, KeyEvent.KEYCODE_7);
        for (int turn = 0; turn < 100 && !ploverReplies.isEmpty(); turn++)
            ploverReplies.remove(0).run();
        assertTrue(ploverReplies.isEmpty());
        assertEquals("prefix video A7", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void inputViewOwnershipResetDropsQueuedKeydownBeforeNextChord() throws Exception {
        ploverReplies.clear(); duplicateHardware = false;
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_Q);
        chord(ime, KeyEvent.KEYCODE_A); // Hold the first Plover reply.
        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_Q, 0);
        ime.onFinishInputView(false); // Q's keyup is owned by another view.
        ime.onStartInputView(new android.view.inputmethod.EditorInfo(), false);
        chord(ime, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C);
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        assertEquals(generation, epoch(ime));
        assertEquals("prefix video", host.editor.getText().toString());
        assertTrue(new JSONObject((String) field(ime, "inputSnapshot")).getBoolean("ploverEnabled"));
        ime.onDestroy();
    }
    @Test public void inputViewResetPreservesAlreadyReleasedChordsQueuedBehindPlover() throws Exception {
        ploverReplies.clear(); duplicateHardware = false;
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_Q);
        chord(ime, KeyEvent.KEYCODE_A);
        chord(ime, KeyEvent.KEYCODE_Q); // Entire exit chord was already released.
        chord(ime, KeyEvent.KEYCODE_7);
        ime.onFinishInputView(false);
        ime.onStartInputView(new android.view.inputmethod.EditorInfo(), false);
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        assertEquals("prefix video 7", host.editor.getText().toString());
        assertFalse(new JSONObject((String) field(ime, "inputSnapshot")).getBoolean("ploverEnabled"));
        ime.onDestroy();
    }
    @Test public void acceptedLiteralKeydownIsNotLostWhenViewResetTakesItsKeyup() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_Q); chord(ime, KeyEvent.KEYCODE_A);
        chord(ime, KeyEvent.KEYCODE_Q);
        hardware(ime, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_A, KeyEvent.META_SHIFT_ON);
        ime.onFinishInputView(false); ime.onStartInputView(editorInfo(host), false);
        hardware(ime, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_A, KeyEvent.META_SHIFT_ON);
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        assertEquals("prefix video A", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void undoToEmptyWithReentrantSelectionDoesNotInvalidateTheSession() throws Exception {
        ploverReplies.clear(); duplicateHardware = false;
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper(); host.omitBounds = true; host.reentrant = true;
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        chord(ime, KeyEvent.KEYCODE_SPACE);
        assertEquals(generation, epoch(ime));
        assertEquals("prefix ", host.editor.getText().toString());
        chord(ime, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C);
        assertEquals("prefix ta", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void viewRestartDuringSustainedPloverKeepsTheEditorCompositionOwned() throws Exception {
        ploverReplies.clear(); duplicateHardware = false; variedPlover = true; translations = 0;
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper(); host.reentrant = true;
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        chord(ime, KeyEvent.KEYCODE_Q);
        chord(ime, KeyEvent.KEYCODE_A);
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        assertEquals("prefix chính thức v", host.editor.getText().toString());
        ime.onFinishInputView(false); ime.onStartInputView(editorInfo(host), false);
        chord(ime, KeyEvent.KEYCODE_A);
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        assertEquals("prefix chính thức video playback grows much longer", host.editor.getText().toString());
        assertEquals(generation, epoch(ime));
        assertTrue(new JSONObject((String) field(ime, "inputSnapshot")).getBoolean("ploverEnabled"));
        ime.onDestroy();
    }
    @Test public void omittedBoundsAndUnavailableSelectionQueriesStillRecognizeOwnWrites() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        host.extractionUnavailable = true; host.surroundingUnavailable = true; host.omitBounds = true;
        android.view.inputmethod.EditorInfo info = new android.view.inputmethod.EditorInfo();
        info.initialSelStart = info.initialSelEnd = -1;
        ime.onStartInput(info, false); ShadowLooper.idleMainLooper();
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        while (!host.selections.isEmpty()) host.selections.remove(0).run();
        chord(ime, KeyEvent.KEYCODE_Q);
        variedPlover = true; translations = 0;
        for (int i = 0; i < 20; i++) {
            chord(ime, KeyEvent.KEYCODE_A);
            while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
            while (!host.selections.isEmpty()) host.selections.remove(0).run();
        }
        assertEquals(generation, epoch(ime));
        assertTrue(host.editor.getText().toString().startsWith("prefix chính thức"));
        assertFalse(host.editor.getText().toString().contains("[0a00a0]"));
        ime.onDestroy();
    }
    @Test public void separatorCommitWithReentrantCallbackEndsTelexExactlyOnce() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper(); host.reentrant = true; host.omitBounds = true;
        modifiers(ime, true);
        int generation = epoch(ime);
        for (int key : new int[]{KeyEvent.KEYCODE_T, KeyEvent.KEYCODE_I, KeyEvent.KEYCODE_E,
                KeyEvent.KEYCODE_E, KeyEvent.KEYCODE_N, KeyEvent.KEYCODE_G, KeyEvent.KEYCODE_S}) input(ime, false, key);
        input(ime, false, KeyEvent.KEYCODE_SPACE);
        assertEquals(generation + 1, epoch(ime));
        assertEquals("prefix tiếng ", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void duplicateNativeTelexCallbacksDoNotDoubleTheTextOrSeparator() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper(); host.reentrant = true; duplicateHardware = true;
        modifiers(ime, true);
        int generation = epoch(ime);
        for (int key : new int[]{KeyEvent.KEYCODE_T, KeyEvent.KEYCODE_I, KeyEvent.KEYCODE_E,
                KeyEvent.KEYCODE_E, KeyEvent.KEYCODE_N, KeyEvent.KEYCODE_G, KeyEvent.KEYCODE_S}) input(ime, false, key);
        input(ime, false, KeyEvent.KEYCODE_SPACE);
        assertEquals(generation + 1, epoch(ime));
        assertEquals("prefix tiếng ", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void sustainedNonMonotonePloverWithoutQueriesMatchesAnIndependentTextModel() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        host.extractionUnavailable = true; host.surroundingUnavailable = true; host.omitBounds = true;
        android.view.inputmethod.EditorInfo info = new android.view.inputmethod.EditorInfo();
        info.initialSelStart = info.initialSelEnd = -1;
        ime.onStartInput(info, false); ShadowLooper.idleMainLooper();
        int generation = epoch(ime);
        variedPlover = true;
        chord(ime, KeyEvent.KEYCODE_Q);
        Random timing = new Random(91);
        List<String> committed = new ArrayList<>();
        for (int step = 0; step < 100; step++) {
            host.reentrant = timing.nextBoolean();
            chord(ime, KeyEvent.KEYCODE_A);
            while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
            JSONArray output = ploverOutputs.get(step);
            StringBuilder commit = new StringBuilder(); String preedit = "";
            for (int part = 0; part < output.length(); part++) {
                JSONObject item = output.getJSONObject(part);
                if ("committed".equals(item.getString("type"))) commit.append(item.getString("text"));
                else preedit = item.getString("text");
            }
            if (commit.length() > 0) committed.add(commit.toString());
            List<String> visible = new ArrayList<>(committed);
            if (!preedit.isEmpty()) visible.add(preedit);
            assertEquals("step="+step, "prefix "+String.join(" ", visible), host.editor.getText().toString());
            if (!host.selections.isEmpty() && timing.nextBoolean())
                host.selections.remove(timing.nextInt(host.selections.size())).run();
            assertEquals(generation, epoch(ime));
        }
        while (!host.selections.isEmpty()) host.selections.remove(timing.nextInt(host.selections.size())).run();
        assertEquals(generation, epoch(ime));
        ime.onDestroy();
    }
    @Test public void delayedEmptyPloverAcknowledgementCannotEndRegrownPreeditWithoutQueries() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        host.extractionUnavailable = true; host.surroundingUnavailable = true; host.omitBounds = true;
        ime.onStartInput(editorInfo(host), false); ShadowLooper.idleMainLooper();
        variedPlover = true;
        chord(ime, KeyEvent.KEYCODE_Q);
        int generation = epoch(ime);
        for (int step = 0; step < 3; step++) {
            chord(ime, KeyEvent.KEYCODE_A);
            settle(host, new Random(step), false);
        }
        chord(ime, KeyEvent.KEYCODE_A); // Retract "vid" to empty.
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        List<Runnable> deletionCallbacks = new ArrayList<>(host.selections);
        host.selections.clear();
        chord(ime, KeyEvent.KEYCODE_A); // Regrow before the deletion is acknowledged.
        settle(host, new Random(4), false);
        for (Runnable callback : deletionCallbacks) callback.run();
        assertEquals(generation, epoch(ime));
        assertEquals("prefix 🙂 tiếng Việt\n中 e\u0301", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void rejectedEmptyWriteCannotCommitOldTextAndRetriesWithoutAnotherKey() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper(); host.reentrant = true;
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        host.rejectedWrites = 1;
        chord(ime, KeyEvent.KEYCODE_SPACE);
        ShadowLooper.idleMainLooper();
        assertEquals("prefix ", host.editor.getText().toString());
        assertEquals(generation, epoch(ime));
        assertEquals(-1, BaseInputConnection.getComposingSpanStart(host.getEditable()));
        ime.onDestroy();
    }
    @Test public void rejectedFinishAfterSuccessfulDeletionCannotResurrectOldPreedit() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper(); host.reentrant = true;
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        host.rejectedFinishes = 1;
        chord(ime, KeyEvent.KEYCODE_SPACE);
        ShadowLooper.idleMainLooper();
        assertEquals("prefix ", host.editor.getText().toString());
        assertEquals(generation, epoch(ime));
        assertEquals(-1, BaseInputConnection.getComposingSpanStart(host.getEditable()));
        ime.onDestroy();
    }
    @Test public void rejectedExplicitFinishCannotLeaveARegionThatOverwritesCommittedText() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper(); host.reentrant = true;
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        host.rejectedFinishes = 1;
        chord(ime, KeyEvent.KEYCODE_APOSTROPHE);
        chord(ime, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C);
        ShadowLooper.idleMainLooper();
        assertEquals("prefix chính thức ta", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void permanentlyRejectedComposingWriteHasBoundedAutomaticRetries() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper(); host.rejectedWrites = 100;
        chord(ime, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C);
        ShadowLooper.idleMainLooper();
        assertEquals("prefix ", host.editor.getText().toString());
        assertTrue("Retries must stop without another event", host.published.size() <= 5);
        host.rejectedWrites = 0;
        chord(ime, KeyEvent.KEYCODE_7);
        assertEquals("prefix ta 7", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void coldSandboxRetainsQueuedModeSwitchesAndInferenceWithoutAnotherKey() throws Exception {
        delayedWarmup = true;
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ime.onStartInput(editorInfo(host), false); ShadowLooper.idleMainLooper();
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        chord(ime, KeyEvent.KEYCODE_Q); chord(ime, KeyEvent.KEYCODE_A);
        chord(ime, KeyEvent.KEYCODE_Q); chord(ime, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C);
        assertEquals("prefix ", host.editor.getText().toString());
        while (!sandboxWarmups.isEmpty()) sandboxWarmups.remove(0).run();
        settle(host, new Random(41), true);
        assertEquals("prefix chính thức video ta", host.editor.getText().toString());
        assertEquals(generation, epoch(ime));
        assertFalse(new JSONObject((String) field(ime, "inputSnapshot")).getBoolean("ploverEnabled"));
        ime.onDestroy();
    }
    @Test public void editorReplacementDoesNotWaitForOrApplyTheOldPloverReply() throws Exception {
        variedPlover = true;
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host old = new Host(ime); ime.connection = old;
        ime.onStartInput(editorInfo(old), false); ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        chord(ime, KeyEvent.KEYCODE_Q); chord(ime, KeyEvent.KEYCODE_A);
        Runnable stale = ploverReplies.remove(0);
        Host current = new Host(ime, "new editor "); ime.connection = current;
        ime.onStartInput(editorInfo(current), false);
        chord(ime, KeyEvent.KEYCODE_A);
        assertEquals("New editor must start its own translation", 2, translations);
        while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
        stale.run();
        while (!old.selections.isEmpty()) old.selections.remove(0).run();
        settle(current, new Random(27), true);
        assertEquals("new editor video playback grows much longer", current.editor.getText().toString());
        assertEquals("prefix chính thức", old.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void editorReplacementCannotPublishTheOldTelexWordIntoTheNewEditor() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host old = new Host(ime); ime.connection = old;
        ime.onStartInput(editorInfo(old), false); ShadowLooper.idleMainLooper();
        modifiers(ime, true);
        input(ime, false, KeyEvent.KEYCODE_T); input(ime, false, KeyEvent.KEYCODE_A);
        assertEquals("prefix ta", old.editor.getText().toString());
        Host current = new Host(ime, "new editor "); ime.connection = current;
        ime.onStartInput(editorInfo(current), false);
        settle(current, new Random(21), true);
        assertEquals("new editor ", current.editor.getText().toString());
        assertEquals("prefix ta", old.editor.getText().toString());
        input(ime, false, KeyEvent.KEYCODE_B);
        assertEquals("new editor b", current.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void oldEditorBoundsCannotConsumeSameLengthAcknowledgementsForTheNewEditor() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host old = new Host(ime); ime.connection = old;
        ime.onStartInput(editorInfo(old), false); ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        Host current = new Host(ime, "new editor "); ime.connection = current;
        ime.onStartInput(editorInfo(current), false);
        int generation = epoch(ime);
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        while (!old.selections.isEmpty()) old.selections.remove(0).run();
        settle(current, new Random(7), true);
        assertEquals(generation, epoch(ime));
        chord(ime, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C);
        assertEquals("new editor chính thức ta", current.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void rejectedTelexWriteRecoversWithoutAnotherKeyOrModeChange() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper(); modifiers(ime, true);
        host.rejectedWrites = 1;
        input(ime, false, KeyEvent.KEYCODE_A);
        ShadowLooper.idleMainLooper();
        assertEquals("prefix a", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void missingConnectionDoesNotAcknowledgeUnpublishedText() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        ime.connection = null;
        chord(ime, KeyEvent.KEYCODE_W, KeyEvent.KEYCODE_C);
        ShadowLooper.idleMainLooper();
        assertEquals("prefix chính thức", host.editor.getText().toString());
        ime.connection = host;
        ime.onStartInputView(editorInfo(host), true);
        settle(host, new Random(4), true);
        assertEquals("prefix chính thức ta", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void laggingExtractedSelectionCannotEndSustainedPloverOrLeaveRawV7() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        chord(ime, KeyEvent.KEYCODE_Q);
        settle(host, new Random(0), false);
        int generation = epoch(ime);
        variedPlover = true; host.staleExtraction = true; host.surroundingUnavailable = true;
        for (int step = 0; step < 5; step++) {
            chord(ime, KeyEvent.KEYCODE_A);
            while (!ploverReplies.isEmpty()) ploverReplies.remove(0).run();
            settle(host, new Random(step), true);
        }
        assertEquals(generation, epoch(ime));
        assertFalse(host.editor.getText().toString().contains("[0a00a0]"));
        assertTrue(new JSONObject((String) field(ime, "inputSnapshot")).getBoolean("ploverEnabled"));
        ime.onDestroy();
    }
    @Test public void transientPloverResetFailureRetainsTheWaitingStroke() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ime.onStartInput(editorInfo(host), false); ShadowLooper.idleMainLooper();
        input(ime, false, KeyEvent.KEYCODE_Q); settle(host, new Random(1), false);
        rejectPloverReset = true;
        input(ime, false, KeyEvent.KEYCODE_Q);
        input(ime, false, KeyEvent.KEYCODE_Q);
        input(ime, false, KeyEvent.KEYCODE_A);
        settle(host, new Random(2), true);
        assertEquals("prefix video", host.editor.getText().toString());
        assertEquals(2, resets);
        assertEquals(1, translations);
        ime.onDestroy();
    }
    @Test public void synchronousPloverResetReplyCannotBlockNativeInferenceAndCommitRaw() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        chord(ime, KeyEvent.KEYCODE_Q);
        int generation = epoch(ime);
        inlinePloverReset = true;
        chord(ime, KeyEvent.KEYCODE_Q);
        assertEquals(generation, epoch(ime));
        assertEquals("prefix chính thức", host.editor.getText().toString());
        ime.onDestroy();
    }
    @Test public void realSelectionMoveToAnEarlierOwnedCaretStillEndsComposition() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        while (!host.selections.isEmpty()) host.selections.remove(0).run();
        int generation = epoch(ime);
        int old = Selection.getSelectionStart(host.getEditable());
        int moved = "prefix [0a00a0]".length(); // A caret position from the earlier raw publication.
        Selection.setSelection(host.getEditable(), moved);
        ime.onUpdateSelection(old, old, moved, moved, -1, -1);
        assertEquals(generation + 1, epoch(ime));
        assertEquals("prefix chính thức", host.editor.getText().toString());
        assertEquals(-1, BaseInputConnection.getComposingSpanStart(host.getEditable()));
        ime.onDestroy();
    }
    @Test public void omittedComposingBoundsDuringModeSwitchDoNotCommitRaw() throws Exception {
        Ime ime = Robolectric.buildService(Ime.class).create().get();
        Host host = new Host(ime); ime.connection = host;
        ShadowLooper.idleMainLooper();
        chord(ime, KeyEvent.KEYCODE_C, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_M);
        while (!host.selections.isEmpty()) host.selections.remove(0).run();
        assertEquals("prefix chính thức", host.editor.getText().toString());
        int generation = epoch(ime);
        host.omitBounds = true;
        chord(ime, KeyEvent.KEYCODE_Q);
        assertEquals("prefix chính thức", host.editor.getText().toString());
        while (!host.selections.isEmpty()) host.selections.remove(0).run();
        assertEquals("IME-owned selection update must not reset its epoch", generation, epoch(ime));
        chord(ime, KeyEvent.KEYCODE_Q);
        for (Runnable reply : new ArrayList<>(ploverReplies)) reply.run();
        ploverReplies.clear();
        while (!host.selections.isEmpty()) host.selections.remove(0).run();
        assertEquals("prefix chính thức", host.editor.getText().toString());
        assertTrue("Raw V7 publication must remain enabled", host.published.contains("[0a00a0]"));
        ime.onDestroy();
    }
}
