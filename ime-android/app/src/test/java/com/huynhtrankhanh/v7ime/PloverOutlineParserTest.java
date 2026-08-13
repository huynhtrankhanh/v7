package com.huynhtrankhanh.v7ime;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class PloverOutlineParserTest {
    @Test
    public void acceptsCanonicalSingleAndMultiStrokeOutlines() {
        assertTrue(PloverOutlineParser.isCanonicalOutline("TEFT"));
        assertTrue(PloverOutlineParser.isCanonicalOutline("HEL/HROE"));
        assertTrue(PloverOutlineParser.isCanonicalOutline("STKPWHRAO*EUFRPBLGTSDZ"));
        assertTrue(PloverOutlineParser.isCanonicalOutline("H-F"));
        assertTrue(PloverOutlineParser.isCanonicalOutline("-F"));
    }

    @Test
    public void rejectsWhitelistMatchesThatAreNotCanonicalOutlines() {
        assertFalse(PloverOutlineParser.isCanonicalOutline("/"));
        assertFalse(PloverOutlineParser.isCanonicalOutline("TEFT/"));
        assertFalse(PloverOutlineParser.isCanonicalOutline("AA"));
        assertFalse(PloverOutlineParser.isCanonicalOutline("hello"));
    }
}
