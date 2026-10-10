package com.huynhtrankhanh.v7ime;

import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.InputConnection;
import android.widget.EditText;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Deque;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
public class V7ImePreeditSynchronizationTest {
    public static class TestIme extends V7ImeService {
        InputConnection connection;

        @Override
        public InputConnection getCurrentInputConnection() {
            return connection;
        }
    }

    private TestIme ime;

    @Before
    public void setup() {
        ime = Robolectric.buildService(TestIme.class).get();
    }

    @Test
    public void acceptsReorderedExpectedComposingSelectionCallbacks() throws Exception {
        set("preeditText", "abcd");
        pendingLengths().addLast(3);
        pendingLengths().addLast(4);

        ime.onUpdateSelection(0, 0, 4, 4, 0, 4);
        ime.onUpdateSelection(4, 4, 3, 3, 0, 3);

        assertEquals("abcd", getString("preeditText"));
        assertTrue(pendingLengths().isEmpty());
    }

    @Test
    public void clearsPreeditOnRealSelectionMoveEvenWithPendingCallbacks() throws Exception {
        set("preeditText", "abcd");
        pendingLengths().addLast(4);

        boolean expected = isExpectedPreeditChangedSelection(4, 4, 2, 2, -1, -1);

        assertFalse(expected);
        assertEquals(1, pendingLengths().size());
    }

    @Test
    public void doesNotAdvancePreeditStateWhenSetComposingTextFails() throws Exception {
        set("preeditText", "old");
        set("preeditGrammarSectionsJson", "[]");
        ime.connection = new BaseInputConnection(new EditText(ime), true) {
            @Override
            public boolean setComposingText(CharSequence text, int newCursorPosition) {
                return false;
            }
        };

        applyPreeditText("new", "[]");

        assertEquals("old", getString("preeditText"));
        assertTrue(pendingLengths().isEmpty());
    }

    @Test
    public void retriesIdenticalSnapshotAfterComposingFailure() throws Exception {
        AtomicInteger attempts = new AtomicInteger();
        ime.connection = new BaseInputConnection(new EditText(ime), true) {
            @Override
            public boolean setComposingText(CharSequence text, int newCursorPosition) {
                return attempts.incrementAndGet() > 1;
            }
        };

        JSONObject packet = new JSONObject()
                .put("snapshot", new JSONObject()
                        .put("epoch", getInputGeneration())
                        .put("text", "new")
                        .put("grammarSections", new JSONArray()));

        applyInputPacket(packet);
        assertEquals("", getString("preeditText"));
        assertEquals(1, attempts.get());

        applyInputPacket(packet);
        assertEquals("new", getString("preeditText"));
        assertEquals(2, attempts.get());
    }

    private void applyPreeditText(String text, String grammarSections) throws Exception {
        Method method = V7ImeService.class.getDeclaredMethod(
                "applyPreeditText",
                String.class,
                String.class
        );
        method.setAccessible(true);
        method.invoke(ime, text, grammarSections);
    }

    private void applyInputPacket(JSONObject packet) throws Exception {
        Method method = V7ImeService.class.getDeclaredMethod(
                "applyInputPacket",
                JSONObject.class
        );
        method.setAccessible(true);
        method.invoke(ime, packet);
    }

    private boolean isExpectedPreeditChangedSelection(
            int oldSelStart,
            int oldSelEnd,
            int newSelStart,
            int newSelEnd,
            int candidatesStart,
            int candidatesEnd) throws Exception {
        Method method = V7ImeService.class.getDeclaredMethod(
                "isExpectedPreeditChangedSelection",
                int.class,
                int.class,
                int.class,
                int.class,
                int.class,
                int.class
        );
        method.setAccessible(true);
        return (Boolean) method.invoke(
                ime,
                oldSelStart,
                oldSelEnd,
                newSelStart,
                newSelEnd,
                candidatesStart,
                candidatesEnd
        );
    }

    @SuppressWarnings("unchecked")
    private Deque<Integer> pendingLengths() throws Exception {
        return (Deque<Integer>) get("pendingPreeditLengths");
    }

    private int getInputGeneration() throws Exception {
        AtomicInteger generation = (AtomicInteger) get("inputGeneration");
        return generation.get();
    }

    private Object get(String name) throws Exception {
        Field field = V7ImeService.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(ime);
    }

    private String getString(String name) throws Exception {
        return (String) get(name);
    }

    private void set(String name, Object value) throws Exception {
        Field field = V7ImeService.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(ime, value);
    }
}
