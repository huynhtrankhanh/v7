package com.huynhtrankhanh.v7ime;

import android.content.Context;
import android.view.KeyEvent;
import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.InputConnection;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.EditText;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

/** Exercises the real service router, not just WebView-synthesized key events. */
@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
public class HardwareClipboardAndSelectionTest {
    public static class TestIme extends V7ImeService {
        InputConnection connection;
        @Override public InputConnection getCurrentInputConnection() { return connection; }
    }
    private static class RecordingWebView extends WebView {
        final List<String> scripts = new ArrayList<>();
        RecordingWebView(Context context) { super(context); }
        @Override public void evaluateJavascript(String script, ValueCallback<String> callback) {
            scripts.add(script);
        }
    }
    private TestIme ime;
    private RecordingWebView web;
    private final List<KeyEvent> hostKeys = new ArrayList<>();
    private final List<String> hostOperations = new ArrayList<>();
    private long time;
    @Before public void setup() throws Exception {
        ime = Robolectric.buildService(TestIme.class).get();
        web = new RecordingWebView(ime);
        set("webView", web);
        set("telexSandbox", new TelexJavaScriptSandbox(ime));
        ime.connection = new BaseInputConnection(new EditText(ime), true) {
            @Override public boolean sendKeyEvent(KeyEvent event) {
                hostKeys.add(event); hostOperations.add("key:" + event.getKeyCode()); return true;
            }
            @Override public boolean finishComposingText() { hostOperations.add("finish"); return true; }
            @Override public CharSequence getSelectedText(int flags) { return "selected\n text  "; }
        };
    }
    private void set(String name, Object value) throws Exception {
        Field field = V7ImeService.class.getDeclaredField(name);
        field.setAccessible(true); field.set(ime, value);
    }
    private boolean key(int action, int code, int modifiers, int repeat) throws Exception {
        return dispatch(new KeyEvent(0, ++time, action, code, repeat, modifiers));
    }
    private boolean dispatch(KeyEvent event) throws Exception {
        Method method = V7ImeService.class.getDeclaredMethod("dispatchHardwareKeyEvent", KeyEvent.class);
        method.setAccessible(true); return (Boolean) method.invoke(ime, event);
    }
    @Test public void clipboardOwnsDigitsRepeatsAndReleaseWithoutWebViewAvailabilityFlag() throws Exception {
        assertTrue(key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_CTRL_LEFT, KeyEvent.META_CTRL_ON, 0));
        assertTrue(key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_3, KeyEvent.META_CTRL_ON, 0));
        assertTrue(key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_3, KeyEvent.META_CTRL_ON, 1));
        assertTrue(key(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_CTRL_LEFT, 0, 0));
        assertTrue(key(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_3, 0, 0));
        assertEquals(2, hostKeys.size());
        assertEquals(1, web.scripts.stream().filter(script -> script.contains("handleAndroidClipboardSlot")).count());
        assertTrue(web.scripts.get(0).contains("(3,false,0,null)"));
    }
    @Test public void duplicateNativeCallbacksCannotPasteTwice() throws Exception {
        KeyEvent down = new KeyEvent(0, ++time, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_2,
                0, KeyEvent.META_CTRL_ON);
        assertTrue(dispatch(down));
        assertTrue(dispatch(down));
        assertEquals(1, web.scripts.stream().filter(script -> script.contains("handleAndroidClipboardSlot")).count());
    }
    @Test public void copySuppliesHostSelectionAndWorksWithNumpad() throws Exception {
        assertTrue(key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ALT_LEFT, KeyEvent.META_ALT_ON, 0));
        assertTrue(key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_NUMPAD_9, KeyEvent.META_ALT_ON, 0));
        assertTrue(web.scripts.get(0).contains("(9,true,0,\"selected\\n text  \")"));
    }
    @Test public void selectionFinishesBeforeArrowAndBalancesModifiersWithoutTogglingMode() throws Exception {
        for (int direction : new int[]{KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN}) {
            for (boolean control : new boolean[]{false, true}) {
                hostKeys.clear(); hostOperations.clear(); set("preeditText", "xin");
                int modifiers = KeyEvent.META_SHIFT_ON | (control ? KeyEvent.META_CTRL_ON : 0);
                if (control) key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_CTRL_LEFT, KeyEvent.META_CTRL_ON, 0);
                key(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_SHIFT_LEFT, modifiers, 0);
                assertTrue(key(KeyEvent.ACTION_DOWN, direction, modifiers, 0));
                assertTrue(key(KeyEvent.ACTION_DOWN, direction, modifiers, 1));
                assertTrue(key(KeyEvent.ACTION_UP, direction, 0, 0));
                key(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SHIFT_LEFT, control ? KeyEvent.META_CTRL_ON : 0, 0);
                if (control) key(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_CTRL_LEFT, 0, 0);
                assertTrue(hostOperations.indexOf("finish") < hostOperations.indexOf("key:" + direction));
                assertEquals(1, hostOperations.stream().filter("finish"::equals).count());
                assertEquals(control ? 7 : 5, hostKeys.size());
                Field mode = V7ImeService.class.getDeclaredField("hardwareInputMode");
                mode.setAccessible(true); assertEquals(HardwareInputMode.V7_PLOVER, mode.get(ime));
            }
        }
    }
}
