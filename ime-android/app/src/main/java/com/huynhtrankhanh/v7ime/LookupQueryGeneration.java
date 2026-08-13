package com.huynhtrankhanh.v7ime;

final class LookupQueryGeneration {
    private int generation;
    private boolean busy;

    int submit() {
        busy = true;
        return ++generation;
    }

    void edited() {
        generation++;
        busy = false;
    }

    boolean owns(int requestGeneration) {
        return requestGeneration == generation;
    }

    boolean isBusy() {
        return busy;
    }

    void completed(int requestGeneration) {
        if (owns(requestGeneration)) busy = false;
    }
}
