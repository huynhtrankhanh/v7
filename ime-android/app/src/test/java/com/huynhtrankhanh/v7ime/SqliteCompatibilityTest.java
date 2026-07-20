package com.huynhtrankhanh.v7ime;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

public class SqliteCompatibilityTest {
    @Test
    public void splitsSchemaWithoutBreakingTriggerBodies() {
        List<String> statements = SqliteCompatibility.splitScript(
                "CREATE TABLE entries(value TEXT);"
                        + "CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN "
                        + "INSERT INTO log(value) VALUES ('a;b');"
                        + "INSERT INTO log(value) VALUES (new.value); END;"
                        + "CREATE INDEX entries_value ON entries(value);"
        );

        assertEquals(3, statements.size());
        assertTrue(statements.get(1).startsWith("CREATE TRIGGER"));
        assertTrue(statements.get(1).contains("'a;b'"));
        assertTrue(statements.get(1).endsWith("END"));
    }

    @Test
    public void skipsOnlyFtsSetupStatements() {
        assertTrue(SqliteCompatibility.shouldSkipStatement(
                "CREATE VIRTUAL TABLE entries_fts USING fts5(value)"
        ));
        assertTrue(SqliteCompatibility.shouldSkipStatement(
                "CREATE TRIGGER update_fts AFTER INSERT ON entries BEGIN "
                        + "INSERT INTO entries_fts(value) VALUES (new.value); END"
        ));
        assertFalse(SqliteCompatibility.shouldSkipStatement(
                "CREATE TABLE entries(value TEXT)"
        ));
    }

    @Test
    public void rewritesFtsSubstringSearchToNativeLike() {
        SqliteCompatibility.Query query = SqliteCompatibility.rewriteQuery(
                "SELECT * FROM entries_fts AS entries "
                        + "WHERE dictionary = ? AND entries_fts MATCH ?",
                Arrays.asList("main.json", "translation:\"100%_done\"")
        );

        assertTrue(query.sql.contains("FROM entries"));
        assertTrue(query.sql.contains(
                "translation LIKE ? ESCAPE '\\' COLLATE NOCASE"
        ));
        assertEquals("main.json", query.parameters.get(0));
        assertEquals("%100\\%\\_done%", query.parameters.get(1));
    }

    @Test
    public void redirectsFtsPopulationCountToEntries() {
        SqliteCompatibility.Query query = SqliteCompatibility.rewriteQuery(
                "SELECT COUNT(*) AS count FROM entries_fts",
                List.of()
        );

        assertEquals(
                "SELECT COUNT(*) AS count FROM entries",
                query.sql
        );
    }
}
