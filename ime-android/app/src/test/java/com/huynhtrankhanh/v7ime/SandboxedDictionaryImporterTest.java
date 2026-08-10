package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SandboxedDictionaryImporterTest {
    @Test
    public void jsonImportMayOnlyReuseJsonDictionaryName() {
        assertTrue(SandboxedDictionaryImporter.canImportJsonOver("json"));
        assertFalse(SandboxedDictionaryImporter.canImportJsonOver("python"));
        assertFalse(SandboxedDictionaryImporter.canImportJsonOver(""));
    }
}
