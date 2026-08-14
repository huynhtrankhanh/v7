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

Space, Enter, Tab, digits, and symbols terminate the word. The IME atomically
commits the converted word plus that separator, ends composition, and starts a
fresh PREEDIT on the next letter. This prevents a completed Telex word from
remaining underlined or being rewritten by the next word.

The supplied adapter's more detailed conversion notes are preserved verbatim
as [the Telex adapter supplement](telex-behavior-supplement.md).
