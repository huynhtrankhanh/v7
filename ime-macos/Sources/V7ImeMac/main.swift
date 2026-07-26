import AppKit
import InputMethodKit

// Entry point for the V7 Vietnamese IME app bundle. macOS's Text Input
// Sources framework launches this executable directly (there is no Xcode
// storyboard/AppDelegate app-lifecycle needed) whenever the user selects
// this input method or when the system pre-launches registered input
// methods at login.
//
// `InputMethodConnectionName` in Info.plist must match the name passed to
// `IMKServer.init(name:bundleIdentifier:)` below, and
// `InputMethodServerControllerClass` must name `V7InputController`.

V7Log.general.info("V7 IME (macOS) starting")

let connectionName = (Bundle.main.infoDictionary?["InputMethodConnectionName"] as? String) ?? "V7ImeMac_Connection"
let bundleIdentifier = Bundle.main.bundleIdentifier ?? "com.huynhtrankhanh.v7ime.mac"

// Touching AppContext.shared here (rather than lazily from the first
// V7InputController) starts the bundled inference-rs subprocess as soon as
// the IME process launches, so the model is warm before the user's first
// chord — matching V7ImeService.warmInferenceModel's intent, just started
// eagerly instead of on first `onCreateInputView`.
_ = AppContext.shared

let server = IMKServer(name: connectionName, bundleIdentifier: bundleIdentifier)
_ = server

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.run()
