import os

/// Central logger for the IME process. Output shows up in Console.app under
/// subsystem `com.huynhtrankhanh.v7ime.mac` — useful since IMKit launches
/// this binary with no attached terminal.
enum V7Log {
    static let general = Logger(subsystem: "com.huynhtrankhanh.v7ime.mac", category: "general")
    static let server = Logger(subsystem: "com.huynhtrankhanh.v7ime.mac", category: "inference-server")
    static let bridge = Logger(subsystem: "com.huynhtrankhanh.v7ime.mac", category: "web-bridge")
    static let controller = Logger(subsystem: "com.huynhtrankhanh.v7ime.mac", category: "input-controller")
}
