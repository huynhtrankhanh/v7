package com.huynhtrankhanh.v7ime;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Compatibility rules between Node's SQLite build and Android framework
 * SQLite.
 */
final class SqliteCompatibility {
    private static final String FTS_TABLE = "ENTRIES_FTS";

    private SqliteCompatibility() {
    }

    static List<String> splitScript(String script) {
        List<String> statements = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        char quote = 0;
        boolean lineComment = false;
        boolean blockComment = false;
        boolean trigger = false;

        for (int index = 0; index < script.length(); index++) {
            char character = script.charAt(index);
            char next = index + 1 < script.length()
                    ? script.charAt(index + 1)
                    : 0;

            if (lineComment) {
                current.append(character);
                if (character == '\n') {
                    lineComment = false;
                }
                continue;
            }
            if (blockComment) {
                current.append(character);
                if (character == '*' && next == '/') {
                    current.append(next);
                    index++;
                    blockComment = false;
                }
                continue;
            }
            if (quote != 0) {
                current.append(character);
                if (character == quote) {
                    if (next == quote && quote != ']') {
                        current.append(next);
                        index++;
                    } else {
                        quote = 0;
                    }
                }
                continue;
            }
            if (character == '-' && next == '-') {
                current.append(character).append(next);
                index++;
                lineComment = true;
                continue;
            }
            if (character == '/' && next == '*') {
                current.append(character).append(next);
                index++;
                blockComment = true;
                continue;
            }
            if (character == '\''
                    || character == '"'
                    || character == '`'
                    || character == '[') {
                quote = character == '[' ? ']' : character;
                current.append(character);
                continue;
            }

            current.append(character);
            String normalized = current.toString().trim()
                    .toUpperCase(Locale.ROOT);
            if (!trigger && normalized.startsWith("CREATE TRIGGER")) {
                trigger = true;
            }
            if (character == ';'
                    && (!trigger || normalized.endsWith("END;"))) {
                addStatement(statements, current);
                trigger = false;
            }
        }
        addStatement(statements, current);
        return statements;
    }

    static boolean shouldSkipStatement(String statement) {
        return statement.toUpperCase(Locale.ROOT).contains(FTS_TABLE);
    }

    static Query rewriteQuery(String sql, List<String> parameters) {
        String normalized = sql;
        List<String> rewrittenParameters = new ArrayList<>(parameters);
        String uppercase = normalized.toUpperCase(Locale.ROOT);

        if (uppercase.contains("FROM ENTRIES_FTS AS ENTRIES")) {
            int matchIndex = uppercase.indexOf("ENTRIES_FTS MATCH ?");
            int parameterIndex = countParametersBefore(normalized, matchIndex);
            normalized = normalized.replaceAll(
                    "(?i)FROM\\s+entries_fts\\s+AS\\s+entries",
                    "FROM entries"
            ).replaceAll(
                    "(?i)entries_fts\\s+MATCH\\s+\\?",
                    "translation LIKE ? ESCAPE '\\\\' COLLATE NOCASE"
            );
            if (parameterIndex >= 0
                    && parameterIndex < rewrittenParameters.size()) {
                rewrittenParameters.set(
                        parameterIndex,
                        toSubstringPattern(rewrittenParameters.get(parameterIndex))
                );
            }
        } else if (uppercase.contains("FROM ENTRIES_FTS")) {
            normalized = normalized.replaceAll(
                    "(?i)FROM\\s+entries_fts",
                    "FROM entries"
            );
        }
        return new Query(normalized, rewrittenParameters);
    }

    private static String toSubstringPattern(String ftsQuery) {
        if (ftsQuery == null) {
            return null;
        }
        String value = ftsQuery;
        String prefix = "translation:\"";
        if (value.startsWith(prefix) && value.endsWith("\"")) {
            value = value.substring(prefix.length(), value.length() - 1)
                    .replace("\"\"", "\"");
        }
        value = value
                .replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
        return "%" + value + "%";
    }

    private static int countParametersBefore(String sql, int boundary) {
        if (boundary < 0) {
            return -1;
        }
        int count = 0;
        char quote = 0;
        for (int index = 0; index < boundary; index++) {
            char character = sql.charAt(index);
            if (quote != 0) {
                if (character == quote) {
                    quote = 0;
                }
            } else if (character == '\'' || character == '"') {
                quote = character;
            } else if (character == '?') {
                count++;
            }
        }
        return count;
    }

    private static void addStatement(
            List<String> statements,
            StringBuilder statement) {
        String value = statement.toString().trim();
        if (value.endsWith(";")) {
            value = value.substring(0, value.length() - 1).trim();
        }
        if (!value.isEmpty()) {
            statements.add(value);
        }
        statement.setLength(0);
    }

    static final class Query {
        final String sql;
        final List<String> parameters;

        Query(String sql, List<String> parameters) {
            this.sql = sql;
            this.parameters = parameters;
        }
    }
}
