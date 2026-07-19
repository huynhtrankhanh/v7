package com.huynhtrankhanh.v7ime;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

final class StrippedPloverClient implements Closeable {
    private static final int CONNECT_TIMEOUT_MS = 2_000;
    private static final int READ_TIMEOUT_MS = 15_000;

    private Socket socket;
    private BufferedReader reader;
    private BufferedWriter writer;
    private String connectedHost = "";
    private int connectedPort;

    synchronized String request(String host, int port, String requestBody)
            throws IOException {
        if (host.isEmpty()) {
            throw new IOException(
                    "Configure the Stripped Plover host in V7 IME settings"
            );
        }
        ensureConnected(host, port);
        try {
            JSONObject request = new JSONObject(requestBody);
            Object requestId = request.opt("id");
            writer.write(request.toString());
            writer.newLine();
            writer.flush();

            while (true) {
                String line = reader.readLine();
                if (line == null) {
                    throw new IOException("Stripped Plover connection closed");
                }
                JSONObject response;
                try {
                    response = new JSONObject(line);
                } catch (Exception ignored) {
                    continue;
                }
                if (response.has("event")
                        || "ready".equals(response.optString("status"))) {
                    continue;
                }
                if (requestId == null || idsMatch(requestId, response.opt("id"))) {
                    return response.toString();
                }
            }
        } catch (Exception error) {
            close();
            if (error instanceof IOException) {
                throw (IOException) error;
            }
            throw new IOException(error.getMessage(), error);
        }
    }

    private boolean idsMatch(Object expected, Object actual) {
        return actual != null && expected.toString().equals(actual.toString());
    }

    private void ensureConnected(String host, int port) throws IOException {
        if (socket != null
                && socket.isConnected()
                && !socket.isClosed()
                && host.equals(connectedHost)
                && port == connectedPort) {
            return;
        }
        close();
        Socket next = new Socket();
        next.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
        next.setSoTimeout(READ_TIMEOUT_MS);
        socket = next;
        reader = new BufferedReader(new InputStreamReader(
                next.getInputStream(),
                StandardCharsets.UTF_8
        ));
        writer = new BufferedWriter(new OutputStreamWriter(
                next.getOutputStream(),
                StandardCharsets.UTF_8
        ));
        connectedHost = host;
        connectedPort = port;
    }

    @Override
    public synchronized void close() {
        closeQuietly(reader);
        closeQuietly(writer);
        closeQuietly(socket);
        reader = null;
        writer = null;
        socket = null;
        connectedHost = "";
        connectedPort = 0;
    }

    private void closeQuietly(Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (IOException ignored) {
            // The connection is already unusable.
        }
    }
}
