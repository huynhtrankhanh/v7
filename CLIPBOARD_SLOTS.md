# Clipboard slots

Android owns ten private text slots, numbered 0–9. They work in both V7 and Stripped Plover composition modes. They are independent of the system clipboard.

## Copy and paste

**Alt+number** copies the host editor's selected text when a selection exists. Otherwise it copies a selection inside the IME buffer, or the entire visible buffer. Empty text leaves the previous slot unchanged. Copying overwrites that slot and reports the result with a native toast.

**Ctrl+number** appends the slot as one fixed island in the IME composition. It appends to the buffer instead of replacing a selection inside the IME. In the host editor, Android inserts composing text at its current cursor or selected range as usual. Text bypasses decoding, capitalization, automatic boundary spacing, and piecemeal syllable editing. Whitespace is exact: `world` after `hello` produces `helloworld`; use ` world` if a separator is wanted. Later predictive islands still receive the pasted text as fixed inference context.

The number row and numeric keypad both work. Shift, Meta, and combined Ctrl+Alt do not trigger slot shortcuts. Holding a shortcut performs it once. Native Android routing consumes its digit down, repeats, and release; digits never enter steno aggregation. Input-generation checks discard stale callbacks. Slots are unavailable in Telex, Normal typing, raw-outline entry, and dictionary management.

## Plover boundary and undo

A Plover paste waits for preceding translation operations to finish. It then resets Plover's translation context, marks the current visible preedit as committed buffer text, and appends the fixed island. Plover remains enabled. The next stroke begins a fresh translation after the literal paste; multi-stroke replacement cannot cross that boundary.

Each paste creates one undo frame. `*` removes the most recent paste. In Plover mode, when the buffer ends at a clipboard island, this undo belongs to V7's buffer history rather than Plover's empty translation context. New Plover translations use Plover's usual undo; after they are undone back to a clipboard boundary, `*` can remove the paste. Undoing the paste preserves the preceding finalized text; it does not revive the old Plover translation context. Consecutive pastes undo individually. Empty-slot paste creates no undo entry and does not terminate Plover preedit. A failed Plover reset aborts paste before changing the buffer.

Copy, editing slots, and clearing slots do not change composition history. Undoing a paste never clears its source slot. A new host input session clears composition as usual but retains slots.

## Screen layout and management

The IME displays a single horizontally scrolling row of occupied slots, with a number and short text preview. Tap an item to paste. Touch targets are at least 44 pixels high. The row contributes to keyboard height only while visible. When every slot is empty it is hidden with zero height, including after an empty-slot shortcut. Feedback uses native toasts, so status messages do not reserve keyboard space.

Open the Android app's **Settings → Manage clipboard slots** to view all ten slots. Choose one to edit exact multiline text, save it, or clear it. Empty text clears that slot. **Clear all slots** asks for confirmation. Clearing is permanent and does not participate in composition undo. Settings and the IME read the same native store; edits appear without recreating the WebView.

## Persistence

`ClipboardSlotStore` uses app-private Android SharedPreferences named `clipboard_slots`. Each slot is saved individually with a synchronous commit whose result is reported to the caller. Slots survive WebView recreation, WebView storage deletion, and process restarts. Clearing Android app data or uninstalling removes them. They are not synced between devices and are not included in the existing Plover database export.

Existing `v7.clipboard-slots.v1` localStorage data is migrated once when accessible. Native storage remains authoritative afterward; clearing slots in Settings prevents migration from bringing them back. The legacy key is removed only after successful migration. New slot operations do not depend on localStorage. If a write fails, the IME retains that change for the session and reports that saving failed.

## Host selection

Shift+Left/Right/Up/Down and Ctrl+Shift+Left/Right/Up/Down belong to the host editor. Native routing sends balanced modifier events and finishes composition before forwarding the first selection navigation event. The editor then extends its selection over committed text; later composing updates from the old input generation cannot replace it. Using another key during Ctrl+Shift cancels the mode-toggle chord.

## Implementation and checks

`src/slottedClipboard.ts` handles slot snapshots, shortcut recognition, and the compact row. `src/ime.ts` serializes strokes and clipboard operations and inserts fixed islands. `V7ImeService` routes native shortcuts directly through `handleAndroidClipboardSlot`, supplies host selected text, and exposes the persistent store through the Android bridge. `SettingsActivity` manages that same store.

`npm run test:clipboard-slots` covers native-bridge persistence with WebView storage disabled, host selection copy, V7 and Plover paste, a delayed Plover reset followed by an immediate stroke, undo, empty layout, Settings edits, modes, and stale callbacks. `tests/slottedClipboard.test.ts` covers storage failures, live Settings updates, shortcut modifiers, exact inference text, and buffer undo. Native tests cover persistence/migration, slot routing, selection modifiers, and cancellation of the mode chord.
