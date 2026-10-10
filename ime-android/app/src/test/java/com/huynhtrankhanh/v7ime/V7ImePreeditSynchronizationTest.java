package com.huynhtrankhanh.v7ime;

import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.InputConnection;
import android.widget.EditText;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Deque;
import static org.junit.Assert.assertEquals;
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

    private void applyPreeditText(String text, String grammarSections) throws Exception {
        Method method = V7ImeService.class.getDeclaredMethod(
                "applyPreeditText",
                String.class,
                String.class
        );
        method.setAccessible(true);
        method.invoke(ime, text, grammarSections);
    }

    @SuppressWarnings("unchecked")
    private Deque<Integer> pendingLengths() throws Exception {
        return (Deque<Integer>) get("pendingPreeditLengths");
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
