import Foundation

/// Process-wide resources shared by every `V7InputController` instance
/// (IMKit creates one controller per text-input client session, but the
/// inference subprocess and bundled resources are singletons — the same
/// "native engine is process-wide" design Android's `V7ImeService` uses).
final class AppContext {
    static let shared = AppContext()

    /// `.../V7ImeMac.app/Contents/Resources`, containing the bundled
    /// `inference-rs` binary, the static web UI, and `bridge.js`.
    let resourcesURL: URL
    let inferenceServer: InferenceServer

    private init() {
        resourcesURL = Bundle.main.resourceURL ?? URL(fileURLWithPath: Bundle.main.bundlePath)
        let binaryURL = resourcesURL.appendingPathComponent("inference-rs")
        let staticDirURL = resourcesURL.appendingPathComponent("static")
        inferenceServer = InferenceServer(
            binaryURL: binaryURL,
            staticDirURL: staticDirURL,
            port: 51823,
            modelPathProvider: { Preferences.modelPath() }
        )
        inferenceServer.start()
    }
}
