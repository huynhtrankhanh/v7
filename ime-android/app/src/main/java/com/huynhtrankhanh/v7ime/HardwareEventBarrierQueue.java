package com.huynhtrankhanh.v7ime;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Holds physical input that arrives after an asynchronous WebView barrier. */
final class HardwareEventBarrierQueue<T> {
    private final ArrayDeque<T> events = new ArrayDeque<>();
    private int activeBarrierId;

    void begin(int barrierId) {
        if (activeBarrierId != 0) {
            throw new IllegalStateException("A hardware-input barrier is already active");
        }
        activeBarrierId = barrierId;
    }

    boolean offerIfActive(T event) {
        if (activeBarrierId == 0) return false;
        events.addLast(event);
        return true;
    }

    List<T> finish(int barrierId, boolean replay) {
        if (activeBarrierId != barrierId) return Collections.emptyList();
        activeBarrierId = 0;
        if (!replay) {
            events.clear();
            return Collections.emptyList();
        }
        List<T> queued = new ArrayList<>(events);
        events.clear();
        return queued;
    }
}
