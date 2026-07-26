import AppKit

/// Maps macOS virtual key codes (`NSEvent.keyCode`, from Carbon's `kVK_*`
/// constants) to the browser `KeyboardEvent.key` / `.code` values that
/// `static/script.js` already understands via `window.handleAndroidKeyEvent`.
///
/// This intentionally mirrors the exact key set captured by
/// `V7ImeService.isCapturedKey` / `getJavascriptKey` / `getJavascriptCode` in
/// the Android IME (`ime-android/app/src/main/java/com/huynhtrankhanh/v7ime/V7ImeService.java`)
/// so the shared web UI's chord tracker behaves identically on both
/// platforms: letters, digits, semicolon, space, the four modifier pairs,
/// and escape.
enum V7KeyCode {
    struct Mapping {
        let key: String
        let code: String
    }

    /// Virtual key codes for the four modifier keys, split by side, so
    /// `flagsChanged` events can be attributed to the physical key that
    /// produced them.
    static let leftShift: UInt16 = 56
    static let rightShift: UInt16 = 60
    static let leftControl: UInt16 = 59
    static let rightControl: UInt16 = 62
    static let leftOption: UInt16 = 58
    static let rightOption: UInt16 = 61
    static let leftCommand: UInt16 = 55
    static let rightCommand: UInt16 = 54

    static let modifierKeyCodes: Set<UInt16> = [
        leftShift, rightShift, leftControl, rightControl,
        leftOption, rightOption, leftCommand, rightCommand,
    ]

    /// Letters, in physical `kVK_ANSI_*` order (values are macOS virtual key
    /// codes; QWERTY letter positions do not increase monotonically).
    private static let letterKeyCodes: [UInt16: Character] = [
        0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x",
        8: "c", 9: "v", 11: "b", 12: "q", 13: "w", 14: "e", 15: "r",
        16: "y", 17: "t", 31: "o", 32: "u", 34: "i", 35: "p", 37: "l",
        38: "j", 40: "k", 45: "n", 46: "m",
    ]

    /// Digits 0-9, in physical `kVK_ANSI_*` order.
    private static let digitKeyCodes: [UInt16: Character] = [
        18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5",
        25: "9", 26: "7", 28: "8", 29: "0",
    ]

    private static let semicolon: UInt16 = 41
    private static let space: UInt16 = 49
    private static let escape: UInt16 = 53

    /// The complete set of virtual key codes this IME captures while active
    /// (mirrors `isCapturedKey` on Android). Any other key is left alone so
    /// normal typing, menu shortcuts, etc. keep working.
    static let capturedKeyCodes: Set<UInt16> = {
        var codes = Set(letterKeyCodes.keys)
        codes.formUnion(digitKeyCodes.keys)
        codes.formUnion(modifierKeyCodes)
        codes.insert(semicolon)
        codes.insert(space)
        codes.insert(escape)
        return codes
    }()

    static func isCaptured(_ keyCode: UInt16) -> Bool {
        capturedKeyCodes.contains(keyCode)
    }

    static func isModifier(_ keyCode: UInt16) -> Bool {
        modifierKeyCodes.contains(keyCode)
    }

    /// Produces the `KeyboardEvent.key` / `.code` pair for a non-modifier
    /// key, matching `V7ImeService.getJavascriptKey` / `getJavascriptCode`.
    static func mapping(for keyCode: UInt16, shiftPressed: Bool) -> Mapping? {
        if let letter = letterKeyCodes[keyCode] {
            let upper = String(letter).uppercased()
            let key = shiftPressed ? upper : String(letter)
            return Mapping(key: key, code: "Key\(upper)")
        }
        if let digit = digitKeyCodes[keyCode] {
            return Mapping(key: String(digit), code: "Digit\(digit)")
        }
        switch keyCode {
        case semicolon:
            return Mapping(key: shiftPressed ? ":" : ";", code: "Semicolon")
        case space:
            return Mapping(key: " ", code: "Space")
        case escape:
            return Mapping(key: "Escape", code: "Escape")
        default:
            return nil
        }
    }

    /// Produces the `key` / `code` pair for a modifier key, matching
    /// `getJavascriptKey` / `getJavascriptCode`'s Shift/Control/Alt/Meta
    /// branches, split by physical left/right side.
    static func modifierMapping(for keyCode: UInt16) -> Mapping? {
        switch keyCode {
        case leftShift:
            return Mapping(key: "Shift", code: "ShiftLeft")
        case rightShift:
            return Mapping(key: "Shift", code: "ShiftRight")
        case leftControl:
            return Mapping(key: "Control", code: "ControlLeft")
        case rightControl:
            return Mapping(key: "Control", code: "ControlRight")
        case leftOption:
            return Mapping(key: "Alt", code: "AltLeft")
        case rightOption:
            return Mapping(key: "Alt", code: "AltRight")
        case leftCommand:
            return Mapping(key: "Meta", code: "MetaLeft")
        case rightCommand:
            return Mapping(key: "Meta", code: "MetaRight")
        default:
            return nil
        }
    }
}
