package com.huynhtrankhanh.v7ime;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class RerankerExecutionPolicyTest {
    @Test
    public void usesAvailableParallelismWithinMobileBound() {
        assertEquals(1, RerankerExecutionPolicy.cpuThreadCount(1));
        assertEquals(2, RerankerExecutionPolicy.cpuThreadCount(2));
        assertEquals(4, RerankerExecutionPolicy.cpuThreadCount(4));
        assertEquals(4, RerankerExecutionPolicy.cpuThreadCount(32));
    }

    @Test
    public void defendsAgainstInvalidProcessorCounts() {
        assertEquals(1, RerankerExecutionPolicy.cpuThreadCount(0));
        assertEquals(1, RerankerExecutionPolicy.cpuThreadCount(-1));
    }
}
