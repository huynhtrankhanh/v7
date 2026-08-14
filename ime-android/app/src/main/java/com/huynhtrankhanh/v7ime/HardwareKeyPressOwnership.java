package com.huynhtrankhanh.v7ime;

import java.util.HashMap;
import java.util.Map;

final class HardwareKeyPressOwnership {
    enum Owner { WEB, EDITOR }

    static final class Claim {
        final Owner owner;
        final int generation;

        Claim(Owner owner, int generation) {
            this.owner = owner;
            this.generation = generation;
        }

        boolean belongsTo(int currentGeneration) {
            return generation == currentGeneration;
        }
    }

    private final Map<Integer, Claim> owners = new HashMap<>();

    void claim(int keyCode, Owner owner, int generation) {
        Claim existing = owners.get(keyCode);
        if (existing == null || !existing.belongsTo(generation)) {
            owners.put(keyCode, new Claim(owner, generation));
        }
    }

    Claim get(int keyCode) {
        return owners.get(keyCode);
    }

    Claim release(int keyCode) {
        return owners.remove(keyCode);
    }

    void remove(int keyCode) {
        owners.remove(keyCode);
    }

    void invalidate() {
        owners.replaceAll((keyCode, claim) -> new Claim(claim.owner, -1));
    }
}
