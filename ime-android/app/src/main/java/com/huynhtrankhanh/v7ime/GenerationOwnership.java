package com.huynhtrankhanh.v7ime;

/** Gives a recreated component exclusive, generation-scoped ownership. */
final class GenerationOwnership<T> {
    private T owner;
    private int generation;

    synchronized int claim(T nextOwner) {
        owner = nextOwner;
        generation += 1;
        return generation;
    }

    synchronized boolean isCurrent(T candidate, int candidateGeneration) {
        return owner == candidate && generation == candidateGeneration;
    }

    synchronized void release(T candidate, int candidateGeneration) {
        if (isCurrent(candidate, candidateGeneration)) {
            owner = null;
        }
    }
}
