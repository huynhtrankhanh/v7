import Foundation

extension Notification.Name {
    /// Posted (on the main thread) whenever `InferenceServer.state` changes.
    /// `userInfo` contains `"state"` (the raw `InferenceServer.State` string)
    /// and `"error"`. Multiple `V7InputController` instances (one per input
    /// client session) observe this instead of a single closure, since the
    /// server itself is a process-wide singleton shared across sessions —
    /// mirroring the "native engine is process-wide" comment on Android's
    /// `V7ImeService`.
    static let v7InferenceServerStateChanged = Notification.Name("V7InferenceServerStateChanged")
}

/// Launches and supervises the bundled `inference-rs --server` binary as a
/// local loopback HTTP subprocess, then proxies `/infer` requests to it.
///
/// This is the "local_http_server" integration approach: it reuses
/// `inference-rs` completely unmodified (same binary, same `--server
/// --port --static-dir --model-path` flags documented in the project
/// README) instead of adding a new native FFI surface. The web UI never
/// talks to this server directly — the `WebBridge` (mirroring Android's
/// `AndroidBridge.requestInference`) proxies every request through this
/// class so state (`inferenceModelState`, port choice, restarts) stays
/// centralized in native code, exactly like `NativeInference`/`V7ImeService`
/// do on Android.
final class InferenceServer {
    enum State: String {
        case notLoaded = "not_loaded"
        case loading
        case ready
        case missing
        case error
    }

    private let binaryURL: URL
    private let staticDirURL: URL
    private let port: UInt16
    private let queue = DispatchQueue(label: "com.huynhtrankhanh.v7ime.mac.inference-server")
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        return URLSession(configuration: config)
    }()

    private var process: Process?
    private var intentionallyStopped = false
    private var restartAttempts = 0

    private(set) var state: State = .notLoaded
    private(set) var lastError: String = ""
    var modelPathProvider: () -> String?

    var baseURL: URL {
        URL(string: "http://127.0.0.1:\(port)")!
    }

    init(binaryURL: URL, staticDirURL: URL, port: UInt16, modelPathProvider: @escaping () -> String?) {
        self.binaryURL = binaryURL
        self.staticDirURL = staticDirURL
        self.port = port
        self.modelPathProvider = modelPathProvider
    }

    func start() {
        queue.async { [self] in
            self.intentionallyStopped = false
            self.launchLocked()
        }
    }

    func stop() {
        queue.async { [self] in
            self.intentionallyStopped = true
            self.process?.terminate()
            self.process = nil
        }
    }

    private func launchLocked() {
        guard let modelPath = modelPathProvider(), FileManager.default.fileExists(atPath: modelPath) else {
            updateState(.missing, error: "No lm.binary is configured. Open V7 IME settings to choose one.")
            return
        }
        guard FileManager.default.fileExists(atPath: binaryURL.path) else {
            updateState(.error, error: "Bundled inference-rs binary is missing from the app bundle: \(binaryURL.path)")
            return
        }

        updateState(.loading, error: "")

        let task = Process()
        task.executableURL = binaryURL
        task.arguments = [
            "--server",
            "--port", String(port),
            "--static-dir", staticDirURL.path,
            "--model-path", modelPath,
        ]
        // The inference process logs progress (including the ~1s KenLM mmap
        // load) to stderr; forward it into Console.app instead of losing it.
        let stderrPipe = Pipe()
        task.standardError = stderrPipe
        task.standardOutput = FileHandle.nullDevice
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            V7Log.server.info("inference-rs: \(text, privacy: .public)")
        }

        task.terminationHandler = { [weak self] terminated in
            self?.queue.async {
                self?.handleTermination(terminated)
            }
        }

        do {
            try task.run()
            process = task
            V7Log.server.info("Launched inference-rs (pid \(task.processIdentifier)) on port \(self.port)")
            pollHealth(attempt: 0)
        } catch {
            updateState(.error, error: "Failed to launch inference-rs: \(error.localizedDescription)")
        }
    }

    private func handleTermination(_ task: Process) {
        process = nil
        guard !intentionallyStopped else { return }
        V7Log.server.error("inference-rs exited unexpectedly (status \(task.terminationStatus)); restarting")
        restartAttempts += 1
        let delay = min(Double(restartAttempts) * 2.0, 15.0)
        queue.asyncAfter(deadline: .now() + delay) { [self] in
            guard !self.intentionallyStopped else { return }
            self.launchLocked()
        }
    }

    /// The axum server only starts listening after KenLM finishes loading
    /// the model (see `inference-rs/src/main.rs`'s `main()`), so a
    /// successful response to any request means inference is fully ready —
    /// there is no separate "server up but model still loading" state to
    /// track, unlike Android's lazily-initialized JNI path.
    private func pollHealth(attempt: Int) {
        guard !intentionallyStopped, process != nil else { return }
        var request = URLRequest(url: baseURL)
        request.timeoutInterval = 2
        session.dataTask(with: request) { [weak self] _, response, _ in
            guard let self else { return }
            self.queue.async {
                if let http = response as? HTTPURLResponse, (200..<500).contains(http.statusCode) {
                    self.restartAttempts = 0
                    self.updateState(.ready, error: "")
                } else if attempt < 40 {
                    self.queue.asyncAfter(deadline: .now() + 0.5) {
                        self.pollHealth(attempt: attempt + 1)
                    }
                } else {
                    self.updateState(.error, error: "Timed out waiting for inference-rs to start listening.")
                }
            }
        }.resume()
    }

    private func updateState(_ newState: State, error: String) {
        state = newState
        lastError = error
        DispatchQueue.main.async {
            NotificationCenter.default.post(
                name: .v7InferenceServerStateChanged,
                object: self,
                userInfo: ["state": newState.rawValue, "error": error]
            )
        }
    }

    /// Proxies one `/infer` request, matching the `{"islands": [...]}` ->
    /// `{"candidates": [[...]]}` contract documented in the project README
    /// and implemented by `perform_inference` in `inference-rs/src/main.rs`.
    func infer(body: String) async throws -> (statusCode: Int, responseBody: String) {
        var request = URLRequest(url: baseURL.appendingPathComponent("infer"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(body.utf8)
        request.timeoutInterval = 10

        let (data, response) = try await session.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        return (statusCode, String(data: data, encoding: .utf8) ?? "")
    }
}
