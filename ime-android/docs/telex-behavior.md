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
Escape also passes through without changing or consuming Telex composition.

Native code records each rendered Telex word synchronously with the current
editor generation before posting its visual PREEDIT update. Enter and mode
switches finalize that latest logical word, even if its visual update is still
queued. Separator commits re-check the editor generation and Telex mode on the
UI thread so delayed work cannot type into a replacement editor or mode.
Every forwarded Telex key carries the native input epoch; WebUI and bridge
updates reject stale epochs after a mode/editor transition. Accepting a
separator atomically reserves the next epoch before waiting for its UI task, so
typing the next word cannot be invalidated even if that task is delayed.
Native PREEDIT clearing publishes the advanced epoch back to the WebUI on
ordinary editor changes and cursor-driven composition cancellation, so the
first key in the new context is accepted without requiring a mode toggle.

The supplied adapter's more detailed conversion notes are preserved verbatim
as [the Telex adapter supplement](telex-behavior-supplement.md).
