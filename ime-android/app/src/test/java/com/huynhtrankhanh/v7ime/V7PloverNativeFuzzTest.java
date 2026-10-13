package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.text.Editable;
import android.text.Selection;
import android.view.KeyEvent;
import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.ExtractedText;
import android.view.inputmethod.ExtractedTextRequest;
import android.widget.EditText;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.AfterClass;
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
        private long generation;
        @Implementation protected void warmAsync(Executor executor, Runnable changed) { ready = true; changed.run(); }
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
            ready = false; generation++;
            try { rpc(new JSONObject().put("session", session).put("close", true)); }
            catch (Exception e) { throw new AssertionError(e); }
        }
    }
    @Implements(value = TelexJavaScriptSandbox.class, isInAndroidSdk = false)
    public static class Telex {
        @Implementation protected void warmAsync(Executor executor, Runnable changed) { }
    }
    @Implements(value = NativeInference.class, isInAndroidSdk = false)
    public static class Inference {
        @Implementation protected static String infer(Context context, String body) throws Exception {
            JSONArray islands = new JSONObject(body).getJSONArray("islands");
            JSONArray parts = new JSONArray();
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
            }
            return new JSONObject().put("candidates", new JSONArray().put(parts)).toString();
        }
    }
    private static final List<Runnable> ploverReplies = new ArrayList<>();
    @Implements(value = BundledStrippedPloverRuntime.class, isInAndroidSdk = false)
    public static class Plover {
        @Implementation protected void request(String body, BundledStrippedPloverRuntime.Callback callback) {
            try {
                JSONObject request = new JSONObject(body);
                JSONArray text = new JSONArray();
                if ("translate".equals(request.getString("method")))
                    text.put(new JSONObject().put("type", "preedit").put("text", "video"));
                String response = new JSONObject().put("result", new JSONObject().put("output", text)).toString();
                ploverReplies.add(() -> callback.onResult(response, ""));
            } catch (Exception e) { throw new AssertionError(e); }
        }
    }
    private static class Host extends BaseInputConnection {
        final Ime ime;
        final EditText editor;
        final List<Runnable> selections = new ArrayList<>();
        boolean omitBounds;
        boolean reentrant;
        boolean partialExtraction;
        boolean extractionUnavailable;
        final List<String> published = new ArrayList<>();
        @Override public boolean sendKeyEvent(KeyEvent event) {
            assertFalse("Printable hardware key leaked to the host", event.getKeyCode() >= KeyEvent.KEYCODE_A
                    && event.getKeyCode() <= KeyEvent.KEYCODE_Z);
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
            int offset = partialExtraction ? Math.max(0, Math.min(Selection.getSelectionStart(getEditable()),
                    Selection.getSelectionEnd(getEditable())) - 1) : 0;
            text.text = getEditable().subSequence(offset, getEditable().length()); text.startOffset = offset;
            text.selectionStart = Selection.getSelectionStart(getEditable()) - offset;
            text.selectionEnd = Selection.getSelectionEnd(getEditable()) - offset;
            return text;
        }
        @Override public boolean setComposingText(CharSequence text, int position) {
            published.add(text.toString());
            int old = Selection.getSelectionStart(getEditable());
            boolean result = super.setComposingText(text, position);
            int end = Selection.getSelectionStart(getEditable());
            int a = omitBounds ? -1 : getComposingSpanStart(getEditable());
            int z = omitBounds ? -1 : getComposingSpanEnd(getEditable());
            Runnable callback = () -> ime.onUpdateSelection(old, old, end, end, a, z);
            if (reentrant) callback.run();
            selections.add(callback);
            return result;
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
    }
    private static void input(Ime ime, boolean caps, int... codes) {
        int modifiers = caps ? KeyEvent.META_CAPS_LOCK_ON : 0;
        for (int code : codes) hardware(ime, KeyEvent.ACTION_DOWN, code, modifiers);
        for (int code : codes) hardware(ime, KeyEvent.ACTION_UP, code, modifiers);
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
