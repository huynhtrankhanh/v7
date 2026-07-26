import AppKit
import WebKit

/// Receives the JS -> native half of the `window.AndroidIme` bridge
/// contract implemented by `Resources/bridge.js`. Method names mirror
/// `V7ImeService.AndroidBridge` on Android one-to-one.
protocol CandidatePanelDelegate: AnyObject {
    func panelDidRequestInference(body: String, requestId: Int)
    func panelDidSetPreeditText(text: String, grammarSectionsJson: String)
    func panelDidRequestKeyboardHeight(_ heightDp: Double)
    func panelDidRequestChangeInputMethod()
    func panelDidRequestUndoRawOutlineStroke()
}

/// A non-activating floating panel hosting a `WKWebView` that loads the
/// shared V7 web UI (`ime.html` / `ime.css` / `script.js`, built unmodified
/// from `src/` and `static/`), the same "dedicated ime.html + shared
/// script.js" combination Android's `V7ImeService.onCreateInputView` loads
/// into its `WebView`. Non-activating so the target application keeps key
/// (first-responder) focus and its own window stays active while this panel
/// is visible next to the caret — the input controller, not the WebView,
/// receives every keystroke via `handleEvent(_:client:)`.
final class CandidatePanelController: NSObject {
    weak var delegate: CandidatePanelDelegate?

    private let panel: NSPanel
    private let webView: WKWebView
    private var pageLoaded = false
    private var pendingBootstrap: [() -> Void] = []

    private static let defaultSize = NSSize(width: 480, height: 168)
    private static let minHeight: CGFloat = 48
    private static let maxHeight: CGFloat = 420

    init(resourcesURL: URL) {
        let contentController = WKUserContentController()
        let config = WKWebViewConfiguration()
        config.userContentController = contentController

        webView = WKWebView(frame: NSRect(origin: .zero, size: CandidatePanelController.defaultSize), configuration: config)
        webView.setValue(false, forKey: "drawsBackground")

        panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: CandidatePanelController.defaultSize),
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary]
        panel.contentView = webView

        super.init()

        contentController.add(self, name: "v7ime")
        webView.navigationDelegate = self

        if let script = try? String(contentsOf: resourcesURL.appendingPathComponent("bridge.js"), encoding: .utf8) {
            let userScript = WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            contentController.addUserScript(userScript)
        } else {
            V7Log.bridge.error("Unable to load bridge.js from \(resourcesURL.path, privacy: .public)")
        }

        let imeHTML = resourcesURL.appendingPathComponent("static/ime.html")
        webView.loadFileURL(imeHTML, allowingReadAccessTo: resourcesURL.appendingPathComponent("static"))
    }

    // MARK: - Visibility

    /// Positions the panel near `anchor` (screen coordinates, AppKit's
    /// bottom-left origin). v1 anchors on the mouse location captured at
    /// activation time rather than the precise caret rectangle: querying
    /// the exact caret position requires `IMKTextInput`'s
    /// `attributes(forCharacterIndex:lineHeightRectangle:)`, which several
    /// third-party text fields implement inconsistently. Anchoring on the
    /// pointer is an approximation documented in README.md's "Known
    /// limitations" and is a reasonable target for a follow-up.
    func show(near anchor: NSPoint) {
        var frame = panel.frame
        frame.origin.x = anchor.x
        frame.origin.y = anchor.y - frame.height - 24
        if let screen = NSScreen.main {
            frame.origin.x = min(frame.origin.x, screen.visibleFrame.maxX - frame.width)
            frame.origin.x = max(frame.origin.x, screen.visibleFrame.minX)
            if frame.origin.y < screen.visibleFrame.minY {
                frame.origin.y = anchor.y + 24
            }
        }
        panel.setFrame(frame, display: true)
        panel.orderFrontRegardless()
    }

    func hide() {
        panel.orderOut(nil)
    }

    /// Mirrors `AndroidBridge.setKeyboardHeight`: the web UI reports how
    /// tall its content actually is (empty/compact vs. multi-candidate rows)
    /// so the host can resize its surface instead of leaving dead space or
    /// clipping content.
    func resize(toContentHeightDp heightDp: Double) {
        let clamped = min(max(heightDp, Double(CandidatePanelController.minHeight)), Double(CandidatePanelController.maxHeight))
        var frame = panel.frame
        let delta = CGFloat(clamped) - frame.height
        frame.size.height = CGFloat(clamped)
        frame.origin.y -= delta
        panel.setFrame(frame, display: true)
    }

    // MARK: - Native -> JS pushes (mirrors V7ImeService.evaluateJavascript callers)

    func dispatchKeyEvent(action: String, key: String, code: String, repeatKey: Bool, shift: Bool, ctrl: Bool, alt: Bool, meta: Bool) {
        let script = "window.handleAndroidKeyEvent && window.handleAndroidKeyEvent(" +
            "\(jsonString(action)),\(jsonString(key)),\(jsonString(code))," +
            "\(repeatKey),\(shift),\(ctrl),\(alt),\(meta))"
        run(script)
    }

    func pushInferenceState(_ state: String) {
        run("window.__v7MacBridgeState && (window.__v7MacBridgeState.inferenceModelState = \(jsonString(state)));" +
            "window.handleAndroidInferenceState && window.handleAndroidInferenceState(\(jsonString(state)))")
    }

    func pushInferenceError(_ message: String) {
        run("window.__v7MacBridgeState && (window.__v7MacBridgeState.inferenceModelError = \(jsonString(message)))")
    }

    func pushInferenceWarmupError(_ message: String) {
        run("window.handleAndroidInferenceWarmupError && window.handleAndroidInferenceWarmupError(\(jsonString(message)))")
    }

    func pushStenoMode(_ enabled: Bool) {
        run("window.__v7MacBridgeState && (window.__v7MacBridgeState.stenoModeEnabled = \(enabled));" +
            "window.handleAndroidStenoModeChanged && window.handleAndroidStenoModeChanged(\(enabled))")
    }

    func pushInferenceResponse(requestId: Int, statusCode: Int, responseBody: String, errorMessage: String) {
        let script = "window.handleAndroidInferenceResponse && window.handleAndroidInferenceResponse(" +
            "\(requestId),\(statusCode),\(jsonString(responseBody)),\(jsonString(errorMessage)))"
        run(script)
    }

    func clearPreeditFromNative() {
        run("window.clearPreeditFromAndroid && window.clearPreeditFromAndroid()")
    }

    private func jsonString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        guard let data, let encoded = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        // encoded looks like ["escaped value"]; strip the array brackets.
        return String(encoded.dropFirst().dropLast())
    }

    private func run(_ script: String) {
        if pageLoaded {
            webView.evaluateJavaScript(script, completionHandler: nil)
        } else {
            pendingBootstrap.append { [weak webView] in
                webView?.evaluateJavaScript(script, completionHandler: nil)
            }
        }
    }
}

extension CandidatePanelController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoaded = true
        let queued = pendingBootstrap
        pendingBootstrap.removeAll()
        queued.forEach { $0() }
    }
}

extension CandidatePanelController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
            return
        }
        switch type {
        case "requestInference":
            guard let requestBody = body["body"] as? String, let requestId = body["requestId"] as? Int else { return }
            delegate?.panelDidRequestInference(body: requestBody, requestId: requestId)
        case "setPreeditText":
            let text = body["text"] as? String ?? ""
            let grammar = body["grammarSectionsJson"] as? String ?? "[]"
            delegate?.panelDidSetPreeditText(text: text, grammarSectionsJson: grammar)
        case "setKeyboardHeight":
            let heightDp = (body["heightDp"] as? NSNumber)?.doubleValue ?? Double(CandidatePanelController.defaultSize.height)
            delegate?.panelDidRequestKeyboardHeight(heightDp)
        case "changeInputMethod":
            delegate?.panelDidRequestChangeInputMethod()
        case "undoRawOutlineStroke":
            delegate?.panelDidRequestUndoRawOutlineStroke()
        default:
            V7Log.bridge.debug("Unhandled bridge message type: \(type, privacy: .public)")
        }
    }
}
