package com.huynhtrankhanh.v7ime;

final class RerankerExecutionPolicy {
    private static final int MAX_CPU_THREADS = 4;

    private RerankerExecutionPolicy() {
    }

    static int cpuThreadCount(int availableProcessors) {
        return Math.max(1, Math.min(MAX_CPU_THREADS, availableProcessors));
    }
}
