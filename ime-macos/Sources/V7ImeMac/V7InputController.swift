import AppKit
import InputMethodKit

/// The system Input Method controller: one instance per text-input client
/// session. This is the macOS analogue of `V7ImeService` (an
/// `InputMethodService`) on Android, and plays the same role:
///
/// - `handleEvent(client:)` is the hardware key-down/key-up capture point,
///   equivalent to `onKeyDown`/`onKeyUp` + `dispatchHardwareKeyEvent`.
/// - `CandidatePanelController`'s `WKWebView` is the equivalent of
///   `V7ImeService`'s `WebView`, hosting the same `ime.html`/`script.js`.
/// - `client()` (an `IMKTextInput`) is the equivalent of
///   `InputConnection`: `setMarkedText`/`insertText` play the role of
///   `setComposingText`/`finishComposingText`.
/// `@objc(V7InputController)` pins the Objective-C runtime name of this
/// class so it exactly matches `InputMethodServerControllerClass` in
/// Info.plist. `IMKServer` looks that key up with `NSClassFromString` when a
/// new input client connects; without the explicit name, Swift would expose
/// the class as `V7ImeMac.V7InputController` (module-qualified) instead.
@objc(V7InputController)
final class V7InputController: IMKInputController {
    private var candidatePanel: CandidatePanelController!
    private var stenoModeEnabled = true
    private var heldModifierKeyCodes: Set<UInt16> = []
    private var modifierChordConsumed = false
    private var currentPreeditText = ""
    private var sessionGeneration = 0

    override init!(server: IMKServer!, delegate: Any!, client inputClient: Any!) {
        super.init(server: server, delegate: delegate, client: inputClient)
        candidatePanel = CandidatePanelController(resourcesURL: AppContext.shared.resourcesURL)
        candidatePanel.delegate = self

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(inferenceServerStateChanged(_:)),
            name: .v7InferenceServerStateChanged,
            object: nil
        )
        // Reflect whatever state the shared server is already in (it may
        // have started before this session existed).
        pushCurrentInferenceState()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - IMKInputController lifecycle

    override func activateServer(_ sender: Any!) {
        super.activateServer(sender)
        sessionGeneration += 1
        currentPreeditText = ""
        heldModifierKeyCodes.removeAll()
        modifierChordConsumed = false
        pushCurrentInferenceState()
        candidatePanel.pushStenoMode(stenoModeEnabled)
        candidatePanel.show(near: NSEvent.mouseLocation)
    }

    override func deactivateServer(_ sender: Any!) {
        commitComposition(sender)
        candidatePanel.hide()
        super.deactivateServer(sender)
    }

    override func commitComposition(_ sender: Any!) {
        finishCurrentPreedit()
        super.commitComposition(sender)
    }

    override func recognizedEvents(_ sender: Any!) -> Int {
        // Android forwards both key-down and key-up so `KeyboardStrokeTracker`
        // can detect "all keys released" (see src/webCore.ts); IMKit only
        // hands controllers key-down by default, so key-up and modifier
        // changes must be explicitly requested here.
        Int(NSEvent.EventTypeMask.keyDown.rawValue | NSEvent.EventTypeMask.keyUp.rawValue | NSEvent.EventTypeMask.flagsChanged.rawValue)
    }

    override func handle(_ event: NSEvent!, client sender: Any!) -> Bool {
        guard let event else { return false }
        switch event.type {
        case .flagsChanged:
            return handleFlagsChanged(event)
        case .keyDown:
            return handleKey(event, isKeyDown: true)
        case .keyUp:
            return handleKey(event, isKeyDown: false)
        default:
            return false
        }
    }

    // MARK: - Hardware key capture (mirrors V7ImeService.dispatchHardwareKeyEvent)

    private func handleFlagsChanged(_ event: NSEvent) -> Bool {
        let keyCode = event.keyCode
        guard V7KeyCode.isModifier(keyCode) else { return false }

        let wasHeld = heldModifierKeyCodes.contains(keyCode)
        let isHeld = modifierBitIsSet(for: keyCode, in: event.modifierFlags)
        if isHeld == wasHeld {
            return false
        }
        if isHeld {
            heldModifierKeyCodes.insert(keyCode)
        } else {
            heldModifierKeyCodes.remove(keyCode)
        }

        // The physical Ctrl+Shift chord toggles STENO capture, exactly like
        // Android's HardwareKeyActionResolver.TOGGLE_STENO. It fires once
        // per press cycle: holding both down toggles once, and releasing
        // either resets the guard so the next chord can toggle again.
        let ctrlHeld = heldModifierKeyCodes.contains(V7KeyCode.leftControl) || heldModifierKeyCodes.contains(V7KeyCode.rightControl)
        let shiftHeld = heldModifierKeyCodes.contains(V7KeyCode.leftShift) || heldModifierKeyCodes.contains(V7KeyCode.rightShift)
        if ctrlHeld && shiftHeld && !modifierChordConsumed {
            modifierChordConsumed = true
            stenoModeEnabled.toggle()
            finishCurrentPreedit()
            candidatePanel.pushStenoMode(stenoModeEnabled)
            return true
        }
        if !ctrlHeld || !shiftHeld {
            modifierChordConsumed = false
        }

        guard stenoModeEnabled else { return false }
        guard let mapping = V7KeyCode.modifierMapping(for: keyCode) else { return false }
        candidatePanel.dispatchKeyEvent(
            action: isHeld ? "keydown" : "keyup",
            key: mapping.key,
            code: mapping.code,
            repeatKey: false,
            shift: shiftHeld,
            ctrl: ctrlHeld,
            alt: heldModifierKeyCodes.contains(V7KeyCode.leftOption) || heldModifierKeyCodes.contains(V7KeyCode.rightOption),
            meta: heldModifierKeyCodes.contains(V7KeyCode.leftCommand) || heldModifierKeyCodes.contains(V7KeyCode.rightCommand)
        )
        return true
    }

    private func handleKey(_ event: NSEvent, isKeyDown: Bool) -> Bool {
        guard stenoModeEnabled else { return false }
        let keyCode = event.keyCode
        guard V7KeyCode.isCaptured(keyCode), !V7KeyCode.isModifier(keyCode) else { return false }

        let modifiers = event.modifierFlags
        let shift = modifiers.contains(.shift)
        guard let mapping = V7KeyCode.mapping(for: keyCode, shiftPressed: shift) else { return false }

        candidatePanel.dispatchKeyEvent(
            action: isKeyDown ? "keydown" : "keyup",
            key: mapping.key,
            code: mapping.code,
            repeatKey: isKeyDown && event.isARepeat,
            shift: shift,
            ctrl: modifiers.contains(.control),
            alt: modifiers.contains(.option),
            meta: modifiers.contains(.command)
        )
        return true
    }

    private func modifierBitIsSet(for keyCode: UInt16, in flags: NSEvent.ModifierFlags) -> Bool {
        switch keyCode {
        case V7KeyCode.leftShift, V7KeyCode.rightShift:
            return flags.contains(.shift)
        case V7KeyCode.leftControl, V7KeyCode.rightControl:
            return flags.contains(.control)
        case V7KeyCode.leftOption, V7KeyCode.rightOption:
            return flags.contains(.option)
        case V7KeyCode.leftCommand, V7KeyCode.rightCommand:
            return flags.contains(.command)
        default:
            return false
        }
    }

    // MARK: - Composition (mirrors V7ImeService.applyPreeditText / finishCurrentPreedit)

    private var textInputClient: IMKTextInput? {
        client() as IMKTextInput?
    }

    private func applyPreeditText(_ text: String) {
        guard text != currentPreeditText else { return }
        currentPreeditText = text
        guard let client = textInputClient else { return }
        if text.isEmpty {
            client.setMarkedText("", selectionRange: NSRange(location: 0, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        } else {
            let selection = NSRange(location: (text as NSString).length, length: 0)
            client.setMarkedText(text, selectionRange: selection, replacementRange: NSRange(location: NSNotFound, length: 0))
        }
    }

    /// Finalizes whatever is currently marked into permanent text, without
    /// changing its content — the same "finishComposingText (instead of
    /// setComposingText with an empty value) deliberately preserves the
    /// text the user already sees" behavior documented on
    /// `V7ImeService.finishCurrentPreedit`.
    private func finishCurrentPreedit() {
        sessionGeneration += 1
        let hadPreedit = !currentPreeditText.isEmpty
        let textToCommit = currentPreeditText
        currentPreeditText = ""
        if hadPreedit, let client = textInputClient {
            client.insertText(textToCommit, replacementRange: NSRange(location: NSNotFound, length: 0))
        }
        candidatePanel.clearPreeditFromNative()
    }

    // MARK: - Inference state fan-out

    @objc private func inferenceServerStateChanged(_ notification: Notification) {
        pushCurrentInferenceState()
    }

    private func pushCurrentInferenceState() {
        let server = AppContext.shared.inferenceServer
        candidatePanel.pushInferenceState(server.state.rawValue)
        if !server.lastError.isEmpty {
            candidatePanel.pushInferenceError(server.lastError)
        }
    }
}

extension V7InputController: CandidatePanelDelegate {
    func panelDidRequestInference(body: String, requestId: Int) {
        let generationAtRequest = sessionGeneration
        Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await AppContext.shared.inferenceServer.infer(body: body)
                await MainActor.run {
                    guard self.sessionGeneration == generationAtRequest else { return }
                    self.candidatePanel.pushInferenceResponse(
                        requestId: requestId,
                        statusCode: result.statusCode,
                        responseBody: result.responseBody,
                        errorMessage: ""
                    )
                }
            } catch {
                await MainActor.run {
                    guard self.sessionGeneration == generationAtRequest else { return }
                    self.candidatePanel.pushInferenceResponse(
                        requestId: requestId,
                        statusCode: 0,
                        responseBody: "",
                        errorMessage: error.localizedDescription
                    )
                }
            }
        }
    }

    func panelDidSetPreeditText(text: String, grammarSectionsJson: String) {
        // Grammar-suggestion spans (Android's SuggestionSpan candidate-diff
        // highlighting) have no direct NSTextInputClient equivalent exposed
        // through IMKTextInput, so v1 renders plain marked text only; the
        // candidate list in the panel itself still shows every alternative.
        applyPreeditText(text)
    }

    func panelDidRequestKeyboardHeight(_ heightDp: Double) {
        candidatePanel.resize(toContentHeightDp: heightDp)
    }

    func panelDidRequestChangeInputMethod() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.keyboard") {
            NSWorkspace.shared.open(url)
        }
    }

    func panelDidRequestUndoRawOutlineStroke() {
        // Raw outline mode is not implemented in v1 (see README "Known
        // limitations"); nothing to undo.
    }
}
