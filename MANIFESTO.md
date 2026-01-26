# Islands and Spacing

**Note:** This feature only affects the frontend. The backend is not affected.

On the server, the notion of islands is rather limited. An island is either a fixed text island or a v7 island.

Currently, the client also shares the same conception of islands. But now, as there are new features, the island types on the client should be different from the island types on the server. There can still be a conversion function before sending the buffer to the server for inference.

But islands on the client affect **spacing**.
