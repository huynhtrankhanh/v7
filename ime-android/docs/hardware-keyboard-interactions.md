# Android hardware-keyboard interactions

V7 IME starts in **STENO** mode whenever a new IME service instance is
created. The selected mode remains active while that service instance lives,
including across editor changes.

## Mode and key behavior

| Physical input               | STENO mode                                                       | Telex mode                                      | Normal typing mode              |
| ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- | ------------------------------- |
| `Ctrl+Shift` chord           | Toggle on release and finalize the current PREEDIT               | Enter Normal mode and finalize PREEDIT          | Toggle to STENO on release      |
| `Ctrl+Tab` chord             | Enter Telex and finalize PREEDIT                                 | Return to STENO and finalize PREEDIT             | Enter Telex                     |
| `Ctrl+Shift` plus other key  | Pass through without toggling (including `Ctrl+Shift+Tab`)        | Pass through without toggling                   | Pass through without toggling   |
| Solo `Ctrl` or `Shift`       | Preserve the modifier's ordinary key-down/key-up behavior        | Preserve ordinary modifier behavior             | Pass through normally           |
| `META`                       | No mode action; use Android's ordinary handling                  | Pass through normally                           | Pass through normally           |
| `Q+A` chord                  | Open Android's input-method picker; do not emit a steno stroke   | Type through Telex                              | Pass both keys through normally |
| `[` down                     | Finalize the current PREEDIT and start a clean composing session | Apply the Telex `ơ` shortcut                    | Pass `[` through normally       |
| `[` repeat/up                | Consume without finalizing again                                 | Repeat/update Telex PREEDIT                      | Pass through normally           |
| `'` down                     | Finalize the current PREEDIT and insert one space                | Commit Telex PREEDIT and apostrophe              | Pass `'` through normally       |
| `'` repeat/up                | Consume without inserting another space                          | Repeat/finish the apostrophe event               | Pass through normally           |
| `Caps Lock`                  | Uppercase all steno output while the current lock state is on    | Apply ordinary cased-key input                   | Pass through to the editor      |
| Backspace                    | Capture as mapped steno input                                    | Replay raw input; pass through when PREEDIT empty | Pass through to the editor      |
| Enter                        | Use the editor's native action                                   | Finalize PREEDIT, then use the native action     | Pass through to the editor      |
| Escape                       | Capture for V7/Plover handling                                   | Pass through to the editor                       | Pass through to the editor      |
| Other letters / `[` / `]`    | Capture mapped keys into steno chords                            | Update Telex PREEDIT                            | Pass through to the editor      |
| Digits and printable symbols | Capture only existing V7 mappings                                | Commit and terminate Telex PREEDIT              | Pass through to the editor      |

Left and right variants of both `Ctrl` and `Shift` participate in the toggle
chord. V7/Normal modifier events pass through as balanced down/up pairs. Native
Telex consumes Shift events while subsequent printable `KeyEvent`s carry the
active Shift state for casing; Ctrl and Meta continue to pass through, as do
Alt events that do not produce printable layout text.
The Ctrl+Shift mode change occurs only after every participating modifier has
been released. Pressing
any non-modifier while the chord is held cancels the pending mode change, so
shortcuts such as `Ctrl+Shift+Arrow` retain their ordinary editor behavior.
`Ctrl+Tab` is exact: adding Shift, Alt, or Meta cancels the mode shortcut and
passes the modified Tab sequence through.

The `Q+A` physical chord maps to the internal steno stroke `#S`, but Android
reserves that stroke for the input-method picker. It is intercepted before V7
decoding or Stripped Plover handling. The toolbar's **Switch** button continues
to open the same picker, including in the collapsed **Normal typing** and
**Stripped Plover** status bars.

## PREEDIT finalization

“Finalize PREEDIT” means:

1. call Android `InputConnection.finishComposingText()`;
2. preserve the text already shown in the editor as committed text;
3. invalidate pending V7 inference/preedit updates;
4. reset V7's in-memory and WebUI composing session.

It does **not** send Backspace/Delete or replace the composing range with an
empty string. Consequently, pressing `[` after composing a phrase leaves that
phrase in the target editor and makes the next steno chord begin a new PREEDIT.

Switching from STENO to normal typing with `Ctrl+Shift` uses the same
finalization sequence. This prevents ordinary hardware input from accidentally
extending a V7 composition. The IME then collapses to a labeled 48 dp
**Normal typing** bar; switching back restores the composition surface. If the
user opens the input-method picker with `Q+A` but cancels it, the current
PREEDIT remains active; selecting another IME causes the normal Android
input-finish lifecycle to finalize it.

Pressing apostrophe performs the same PREEDIT finalization and then commits a
single ordinary space through Android's input connection. Key repeat and key-up
are consumed, so one press produces exactly one separator.

## Event-routing order

Android native key handling runs before WebView dispatch:

1. track the native `Ctrl+Shift` mode chord and toggle only after its release;
2. while in STENO, resolve and consume `[` and apostrophe PREEDIT actions;
3. while in normal typing mode, pass all other events back to the editor;
4. while in STENO, forward captured steno keys to the WebUI;
5. carry the current native Caps Lock state with every event and uppercase
   every cased character emitted anywhere in the steno pipeline while it is
   active, including V7, Emily, Stripped Plover, rendered candidates,
   and piecemeal edits; candidate selection preserves the casing attached when
   each output was produced and never retroactively uppercases older text;
6. after chord aggregation, reserve `Q+A`/`#S` for the input-method picker.

This ordering keeps the mode-control chord out of steno aggregation while
preserving balanced modifier events and ordinary modified editor shortcuts.
Telex captures any unmodified printable key reported by Android, including
numpad and layout-specific characters, plus its non-printable editing keys. In
V7/Plover those Telex-only keys retain the pre-Telex pass-through behavior.
Printable Alt/AltGr layout output is also captured to terminate Telex PREEDIT;
Ctrl-only and Meta shortcuts continue to pass directly to the editor.

V7/Plover Web-owned presses retain their starting input generation. Telex is
different: Android handles its raw buffer, Backspace, PREEDIT, terminators, and
mode changes directly. Each raw-word conversion is a synchronous call to a
persistent DOM-free `JavaScriptSandbox`; no Telex hardware event is sent through
the WebView, queued, acknowledged, or replayed. Every initial Telex key-down is
claimed by either the native reducer or the editor, and repeats plus key-up keep
that owner. A handled native repeat refreshes its claim after a separator or
Enter advances the PREEDIT generation; an editor/lifecycle invalidation replaces
the claim and therefore cannot be resurrected by that refresh. This preserves
balanced navigation, modifier, Enter, and autorepeat lifecycles.
Once held Backspace empties the native raw buffer, the next repeat explicitly
transfers that press to ordinary editor routing and continues deleting committed
text; merely reaching an empty buffer does not leak the preceding key-up.

Telex and background dictionary import share one application-wide AndroidX
`JavaScriptSandbox` and use distinct isolates. Sandbox creation, bundle loading,
and V7 tone-oracle warm-up happen off the IME thread. The Telex banner visibly
reports Latin fallback until the isolate is ready; warmed key conversion is
bounded to 100 ms.
If the shared sandbox process dies, its singleton is invalidated so Telex
warm-up and subsequent dictionary-import retries can create a fresh process.
Timed-out sandbox connection futures are cancelled so AndroidX runs its service
unbind listener before a later reconnect attempt.
Dead-accent key events remain native until the following printable character;
Android's `getDeadChar()` result is then appended to Telex as one Unicode code
point instead of splitting the dead key between the editor and PREEDIT.

Raw-outline editor fields take precedence over the saved V7/Telex/Normal mode.
Even when Telex is the stored mode, their keys use the existing raw-outline
WebUI chord path; leaving the field restores Telex without changing the saved
mode.

## Raw outline fields

The native lookup stroke field and add-translation outline field request
**Raw outline mode** from V7 IME. Captured chords are inserted into the active
textbox as one `/`-delimited outline. A lone `*` chord is reserved for undo: it
removes the most recent in-progress stroke, or removes the last delimited
stroke before the textbox cursor when the in-progress buffer is already empty.
It is never appended as a literal stroke in this mode. Translation and
lookup-text fields do not request a private mode: they use standard V7 and
preserve the user's current STENO/Normal selection. Ctrl+Shift therefore keeps
working in those fields instead of being suppressed by a forced Normal mode.

## Native form submission

Lookup fields treat Enter as form submission. In add-translation, the outline
field advertises `IME_ACTION_NEXT` and moves to ordinary translation text; the
translation field is multiline, so Enter inserts a newline. `Ctrl+Enter` and
`Ctrl+Numpad Enter` add the entry once the form is complete and a destination
has been explicitly selected. The Add button remains reachable by keyboard.

## Native command-dialog navigation

Stripped Plover lookup and add-translation commands open as one reusable
transient native dialog activity above the application containing the current
editor. It uses an empty task affinity and a dedicated excluded, no-history
task, so an already open V7 Settings task is not brought forward behind the
dialog. A later command refreshes that activity in place; it cannot leave old
dialog tasks behind for Android to resurface. The full, wrapping title is part
of the dialog content rather than a truncating platform title bar.

The pinned command protocol does not type its argument, so command arguments
always populate Translation because text such as `HAT` is inherently
ambiguous. With no argument, focus starts in Stroke.
`Tab` and `Shift+Tab` move forward
and backward through the editable fields, the dictionary radio group as one
tab stop, populated selectable results/errors, the lookup actions, and Close
button with wraparound. Arrow keys move and select within the radio group;
disabled controls are skipped and newly focused controls are
scrolled into view. Labels are linked to their fields and changing status text
is exposed as a polite accessibility announcement. `Escape` closes the dialog.
Enter keeps the submission behavior described above. Only unmodified Escape is
routed away from steno capture while the command activity is active.

The dialog requests the IME surface when its first field receives focus and
keeps it visible while focus moves between controls. It resizes around that
surface instead of initially hiding it, and touching outside the dialog does
not silently discard the form.

Writable dictionaries are shown as numbered radio choices rather than hidden
behind a Spinner. Every choice is a full-width, at-least-48-dp target and one
tap both checks and focuses it. With a choice focused, number-row or numpad keys `1` through
`9` select and focus the matching dictionary directly. `Alt+1` through
`Alt+9` provide the same access from anywhere in the dialog without stealing
ordinary digits from the translation field; arrow-key radio navigation remains
available. When a non-editor control owns focus, the IME explicitly passes
dialog-navigation keys back to the activity instead of retaining the previous
outline editor's steno-routing contract. Ctrl and Shift remain with the IME so
the ordinary Ctrl+Shift mode toggle works; returning to an editor restores that
editor's Raw-outline or standard-V7 routing without changing the saved mode.
