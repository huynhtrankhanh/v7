import Foundation

/// Minimal on-disk configuration, playing the same role as Android's
/// `ImePreferences.getModelUri` (a Storage-Access-Framework document the
/// user picks once in Settings). There is no in-app settings UI yet (see
/// README "Known limitations"), so for v1 this is a small JSON file the
/// user (or an install script) can edit directly.
struct Preferences {
    private static var configURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("V7ImeMac/config.json")
    }

    /// Fallback search order when no config file exists yet: prefer a copy
    /// staged next to the app's own support directory, then the exact path
    /// the user pointed this project at during development
    /// (`~/Downloads/lm.binary`), matching how this repository's own
    /// `lm.binary` was sourced for local testing.
    private static var fallbackModelPaths: [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return [
            appSupport.appendingPathComponent("V7ImeMac/lm.binary").path,
            home.appendingPathComponent("Downloads/lm.binary").path,
        ]
    }

    static func modelPath() -> String? {
        if let configured = readConfig()["modelPath"] as? String, FileManager.default.fileExists(atPath: configured) {
            return configured
        }
        return fallbackModelPaths.first { FileManager.default.fileExists(atPath: $0) }
    }

    static func setModelPath(_ path: String) {
        var config = readConfig()
        config["modelPath"] = path
        writeConfig(config)
    }

    private static func readConfig() -> [String: Any] {
        guard let data = try? Data(contentsOf: configURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        return json
    }

    private static func writeConfig(_ config: [String: Any]) {
        try? FileManager.default.createDirectory(at: configURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let data = try? JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted]) else { return }
        try? data.write(to: configURL)
    }
}
