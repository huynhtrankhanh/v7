# Android hardware-keyboard interactions

V7 IME starts in **STENO** mode whenever a new IME service instance is
created. The selected mode remains active while that service instance lives,
including across editor changes.

## Mode and key behavior

| Physical input               | STENO mode                                                       | Normal typing mode              |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------- |
| `Ctrl+Shift` chord           | Toggle on release and finalize the current PREEDIT               | Toggle to STENO on release      |
| `Ctrl+Shift` plus other key  | Pass through without toggling (for example, selection shortcuts) | Pass through without toggling   |
| Solo `Ctrl` or `Shift`       | Preserve the modifier's ordinary key-down/key-up behavior        | Pass through normally           |
| `META`                       | No mode action; use Android's ordinary handling                  | Pass through normally           |
| `Q+A` chord                  | Open Android's input-method picker; do not emit a steno stroke   | Pass both keys through normally |
| `[` down                     | Finalize the current PREEDIT and start a clean composing session | Pass `[` through normally       |
| `[` repeat/up                | Consume without finalizing again                                 | Pass through normally           |
| Other unmodified mapped keys | Capture and aggregate into steno chords                          | Pass through to the editor      |

Left and right variants of both `Ctrl` and `Shift` participate in the toggle
chord. All modifier events pass through as balanced down/up pairs. The mode
changes only after every participating modifier has been released. Pressing
any non-modifier while the chord is held cancels the pending mode change, so
shortcuts such as `Ctrl+Shift+Arrow` retain their ordinary editor behavior.

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

## Event-routing order

Android native key handling runs before WebView dispatch:

1. track the native `Ctrl+Shift` mode chord and toggle only after its release;
2. while in STENO, resolve and consume `[`;
3. while in normal typing mode, pass all other events back to the editor;
4. while in STENO, forward captured steno keys to the WebUI;
5. after chord aggregation, reserve `Q+A`/`#S` for the input-method picker.

This ordering keeps the mode-control chord out of steno aggregation while
preserving balanced modifier events and ordinary modified editor shortcuts.
