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
`[`/`]` shortcuts are supported. Repeating a command key escapes it, allowing
ordinary Latin typing such as `Windows` without leaving Telex.

Space, Tab, digits, and symbols terminate the word. This includes numpad input
and layout-specific printable keys reported by Android. The WebUI hands Android the
expected converted word and separator together; Android applies both in one UI
task, ends composition, and starts a fresh
PREEDIT on the next letter. Enter instead finalizes the word and follows the
editor's normal Android action: Next, Done, Go, Search, Send, a custom action,
or a physical newline when the editor advertises no action. This prevents a
completed Telex word from remaining underlined or being rewritten by the next
word.

Backspace removes raw Telex keystrokes, including key-repeat events, while a
word is being composed. When PREEDIT is empty, Backspace is passed through to
the editor so it can delete previously committed spaces and text normally.

The supplied adapter's more detailed conversion notes are preserved verbatim
as [the Telex adapter supplement](telex-behavior-supplement.md).
