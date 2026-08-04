package com.huynhtrankhanh.v7ime;

final class KeyboardFocusCycle {
    private KeyboardFocusCycle() {
    }

    static int nextIndex(int current, boolean backwards, boolean[] eligible) {
        if (eligible.length == 0) {
            return -1;
        }
        int direction = backwards ? -1 : 1;
        int index = current >= 0 && current < eligible.length
                ? current
                : backwards ? 0 : -1;
        for (int attempts = 0; attempts < eligible.length; attempts++) {
            index = Math.floorMod(index + direction, eligible.length);
            if (eligible[index]) {
                return index;
            }
        }
        return -1;
    }
}
