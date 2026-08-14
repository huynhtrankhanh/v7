package com.huynhtrankhanh.v7ime;

final class TelexPreeditState {
    private String text = "";
    private int generation = -1;

    synchronized void remember(String nextText, int nextGeneration) {
        text = nextText == null ? "" : nextText;
        generation = nextGeneration;
    }

    synchronized String take(int expectedGeneration) {
        if (generation != expectedGeneration) return null;
        String latest = text;
        text = "";
        generation = -1;
        return latest;
    }
}
