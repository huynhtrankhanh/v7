package com.huynhtrankhanh.v7ime;

import android.content.Context;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
public class ClipboardSlotStoreTest {
    private Context context;
    @Before public void clear() {
        context = RuntimeEnvironment.getApplication();
        context.getSharedPreferences("clipboard_slots", Context.MODE_PRIVATE).edit().clear().commit();
    }
    @Test public void settingsAndImeShareAllTenPersistentSlots() {
        ClipboardSlotStore ime = new ClipboardSlotStore(context);
        for (int slot = 0; slot < 10; slot++) assertTrue(ime.set(slot, "\n Tiếng Việt " + slot + "  "));
        ClipboardSlotStore settings = new ClipboardSlotStore(context);
        assertEquals("\n Tiếng Việt 9  ", settings.get(9));
        assertTrue(settings.set(1, "Settings edit"));
        assertEquals("Settings edit", ime.get(1));
        assertTrue(settings.set(0, null));
        assertNull(ime.get(0));
        assertFalse(ime.set(-1, "bad"));
        assertFalse(ime.set(10, "bad"));
        assertTrue(settings.clear());
        assertEquals("[null,null,null,null,null,null,null,null,null,null]", ime.toJson());
    }
    @Test public void legacyMigrationIsValidatedAndCannotResurrectClearedItems() {
        ClipboardSlotStore store = new ClipboardSlotStore(context);
        assertFalse(store.migrate("[\"bad\"]"));
        assertFalse(store.migrate("[4,null,null,null,null,null,null,null,null,null]"));
        String legacy = "[\" preserved  \",null,null,null,null,null,null,null,null,null]";
        assertTrue(store.migrate(legacy));
        assertEquals(" preserved  ", store.get(0));
        assertTrue(store.clear());
        assertTrue(store.migrate(legacy));
        assertNull(store.get(0));
    }
}
