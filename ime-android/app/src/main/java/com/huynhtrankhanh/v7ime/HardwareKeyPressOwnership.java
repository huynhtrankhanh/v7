package com.huynhtrankhanh.v7ime;

import java.util.HashMap;
import java.util.Map;

final class HardwareKeyPressOwnership {
    enum Owner { WEB, EDITOR }

    private final Map<Integer, Owner> owners = new HashMap<>();

    void claim(int keyCode, Owner owner) {
        owners.putIfAbsent(keyCode, owner);
    }

    Owner get(int keyCode) {
        return owners.get(keyCode);
    }

    Owner release(int keyCode) {
        return owners.remove(keyCode);
    }

    void remove(int keyCode) {
        owners.remove(keyCode);
    }

    void clear() {
        owners.clear();
    }
}
