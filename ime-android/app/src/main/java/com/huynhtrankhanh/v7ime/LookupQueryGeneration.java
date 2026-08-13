package com.huynhtrankhanh.v7ime;

final class LookupQueryGeneration {
    private int generation;

    int submit() {
        return ++generation;
    }

    void edited() {
        generation++;
    }

    boolean owns(int requestGeneration) {
        return requestGeneration == generation;
    }
}
