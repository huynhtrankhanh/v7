package com.huynhtrankhanh.v7ime;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

public class AppDataTransferTest {
    @Rule
    public TemporaryFolder temporaryFolder = new TemporaryFolder();

    @Test
    public void copySqlitePreservesAValidDatabaseStream() throws Exception {
        byte[] header = "SQLite format 3\0".getBytes(StandardCharsets.US_ASCII);
        byte[] source = new byte[header.length + 4];
        System.arraycopy(header, 0, source, 0, header.length);
        source[source.length - 1] = 42;
        File destination = temporaryFolder.newFile("staged.sqlite");

        AppDataTransfer.copySqlite(
                new ByteArrayInputStream(source),
                destination
        );

        assertArrayEquals(source, Files.readAllBytes(destination.toPath()));
    }

    @Test
    public void copySqliteRejectsOtherFileTypes() throws Exception {
        File destination = temporaryFolder.newFile("invalid.sqlite");

        assertThrows(
                java.io.IOException.class,
                () -> AppDataTransfer.copySqlite(
                        new ByteArrayInputStream("not sqlite".getBytes(
                                StandardCharsets.US_ASCII
                        )),
                        destination
                )
        );
    }

    @Test
    public void replaceDatabaseSwapsTheStagedFile() throws Exception {
        File database = temporaryFolder.newFile("database.sqlite");
        Files.write(database.toPath(), "old".getBytes(StandardCharsets.UTF_8));
        File staged = temporaryFolder.newFile("staged.sqlite");
        Files.write(staged.toPath(), "new".getBytes(StandardCharsets.UTF_8));

        AppDataTransfer.replaceDatabase(staged, database);

        assertEquals(
                "new",
                new String(Files.readAllBytes(database.toPath()), StandardCharsets.UTF_8)
        );
        assertFalse(staged.exists());
        assertEquals(1, temporaryFolder.getRoot().listFiles().length);
    }
}
