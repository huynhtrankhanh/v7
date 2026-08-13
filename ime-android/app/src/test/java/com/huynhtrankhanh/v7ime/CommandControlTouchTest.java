package com.huynhtrankhanh.v7ime;

import android.app.Activity;
import android.view.MotionEvent;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;

import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
public class CommandControlTouchTest {
    @Test
    public void firstTapClicksButtonWhileEditorOwnsFocus() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        LinearLayout root = new LinearLayout(activity);
        EditText editor = new EditText(activity);
        Button button = new Button(activity);
        root.addView(editor);
        root.addView(button);
        activity.setContentView(root);
        editor.requestFocus();
        button.setFocusable(true);
        button.setFocusableInTouchMode(false);
        AtomicInteger clicks = new AtomicInteger();
        button.setOnClickListener(view -> clicks.incrementAndGet());

        tap(button);

        assertEquals(1, clicks.get());
    }

    @Test
    public void radioRequestsFocusOnlyAfterItsFirstTapClicks() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        RadioButton radio = new RadioButton(activity);
        activity.setContentView(radio);
        radio.setFocusable(true);
        radio.setFocusableInTouchMode(false);
        AtomicInteger clicks = new AtomicInteger();
        radio.setOnClickListener(view -> {
            clicks.incrementAndGet();
            radio.requestFocusFromTouch();
        });

        tap(radio);

        assertEquals(1, clicks.get());
        assertTrue(radio.isChecked());
        assertTrue(radio.hasFocus());
    }

    private static void tap(android.view.View view) {
        long now = 100;
        view.dispatchTouchEvent(MotionEvent.obtain(
                now, now, MotionEvent.ACTION_DOWN, 1, 1, 0
        ));
        view.dispatchTouchEvent(MotionEvent.obtain(
                now, now + 10, MotionEvent.ACTION_UP, 1, 1, 0
        ));
    }
}
