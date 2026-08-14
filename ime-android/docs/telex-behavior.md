# Telex hardware-input mode

V7 IME has three hardware-input states. It starts in **V7/Plover**:

| Current state | `Ctrl+Tab` | `Ctrl+Shift` |
| --- | --- | --- |
| V7/Plover | Telex | Normal typing |
| Telex | V7/Plover | Normal typing |
| Normal typing | Telex | V7/Plover |

The shortcuts fire once per press. Switching modes finalizes the current
Android PREEDIT without deleting its visible text. Raw-outline editor fields
continue to reserve their existing capture behavior.

In **Telex**, letter keys build a replayable raw word and the converted NFC
Vietnamese word is sent to Android as composing text after every key. Backspace
removes one raw keystroke, so transformations and tone placement are replayed
correctly. Standard Telex shapes (`aa`, `aw`, `ee`, `oo`, `ow`, `uw`, `dd`),
tones (`s`, `f`, `r`, `x`, `j`), tone removal (`z`), standalone `w`, and the
UniKey-compatible `[` → `ơ` and `]` → `ư` shortcuts are supported. Repeating a command key escapes it, allowing
ordinary Latin typing such as `Windows` without leaving Telex.

The Android IME enables free marking: delayed `uo` + `w` applies both horns in
one command even after a coda, so `dduongwf` produces `đường`. The standalone
converter keeps its conservative opt-in default for callers outside the IME.

Space, Tab, digits, and symbols terminate the word. This includes numpad input
and layout-specific printable keys reported by Android. Native Telex handling
applies the synchronously converted word and separator in the same hardware-key
callback, ends composition, and starts a fresh
PREEDIT on the next letter. Enter instead finalizes the word and follows the
editor's normal Android action: Next, Done, Go, Search, Send, a custom action,
or a physical newline when the editor advertises no action. This prevents a
completed Telex word from remaining underlined or being rewritten by the next
word.

Backspace removes raw Telex keystrokes, including key-repeat events, while a
word is being composed. When PREEDIT is empty, Backspace is passed through to
the editor so it can delete previously committed spaces and text normally. If
a held Backspace exhausts PREEDIT, ownership transfers to the editor for the
remaining repeats and matching key-up, so deletion continues without requiring
the user to release and press the key again.
Escape also passes through without changing or consuming Telex composition.

Android owns the Telex raw-keystroke buffer, Backspace replay, PREEDIT,
separator commits, Enter behavior, and mode transitions. It does not forward
Telex hardware events through the WebView and does not maintain an asynchronous
event queue or barrier protocol.

For linguistic conversion only, native code calls a persistent, DOM-free
AndroidX `JavaScriptSandbox` isolate synchronously with the current raw word.
The isolate contains the same bundled `convertTelex` implementation used by the
TypeScript unit tests. Its returned NFC string is applied immediately with
`InputConnection.setComposingText()`. Space and symbols synchronously finish
that composing range and commit their separator before the hardware callback
returns; Enter and mode changes likewise finalize directly. If the sandbox is
unavailable, the native fallback returns the raw Latin word rather than dropping
input. This removes WebView timing, epochs, acknowledgements, barriers, and FIFO
replay from Telex typing.

The supplied adapter's more detailed conversion notes are preserved as
[the Telex adapter supplement](telex-behavior-supplement.md), with an explicit
erratum for the archived document's reversed bracket shortcuts.
