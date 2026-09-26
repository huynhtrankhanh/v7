# V7 clipboard slots

V7 has ten private clipboard slots, numbered 0–9. They are independent of the system clipboard; Ctrl+C keeps its Android host-editor behavior. Open **Clipboard slots** above the editor to see previews and use the same actions with buttons.

| Action | Shortcut | Result |
| --- | --- | --- |
| Copy to slot | Alt+number | Save selected editor text; with no editor selection, save the whole visible buffer. |
| Paste slot | Ctrl+number | Append saved text to the buffer as a new fixed text island. |
| Clear slot | Clear button beside slot | Remove that saved item. |
| Clear all | Clear all slots button | Remove all ten saved items. |

## Selection and insertion

Copy stores plain rendered text, including accents, capitalization, spaces, and newlines. The currently displayed top inference candidate is used when copying the buffer. When inference is unavailable, visible V7 code markers are copied as displayed. Selections outside the editor do not supply slot text. Copying an empty buffer leaves the previous slot unchanged. Copy overwrites an occupied slot immediately, with a status message identifying the slot and character count.

Paste always appends at the end of the island buffer, even when text is selected or the piecemeal cursor is active. It does not replace a selection. Each paste creates one independent fixed island and exits piecemeal navigation. Its text bypasses V7 decoding, capitalization, and automatic spacing at both boundaries. Include any desired separator in the saved text: pasting `world` after `hello` produces `helloworld`; pasting ` world` produces `hello world`. Later V7 islands are inferred normally, with the pasted text provided as fixed context. Fixed clipboard text is not a piecemeal syllable-edit target.

Each successful paste saves one normal history frame. The normal `*` undo stroke (Spacebar by itself) removes that paste and restores the preceding buffer and piecemeal cursor. Repeated pastes undo individually. Empty-slot paste reports “Slot N is empty” and creates no history entry. Copy and clearing slots do not modify the buffer or its undo history; undoing a paste does not clear its source slot.

## Availability and keyboard behavior

The feature appears only in V7 composition mode, including its compositional and dictionary strokes. The panel and slot shortcuts are unavailable in Stripped Plover, Android plain typing, Telex, raw-outline mode, and dictionary management pages. Existing slots survive mode changes. V7 composition permits copying into private slots independently of OS clipboard permissions.

## Android IME

Android is the primary client. Its dark clipboard panel sits beneath the IME toolbar, has touch targets of at least 44 pixels for actions, and contributes to the measured keyboard height. Opening the slot list requests a height update so the composition area remains available. Clear buttons provide a touch UI even with no hardware keyboard.

The WebUI reports slot availability to the native service through `setClipboardSlotsEnabled`, so switching to Stripped Plover also releases the shortcuts. The native hardware key handler captures Ctrl+digit and Alt+digit only while slots are enabled in V7 mode. It forwards digit-down and digit-up events, modifier flags, repeat state, and the input-generation epoch through `handleAndroidKeyEvent`. The numeric keypad is supported too. Other modified keys keep their usual host-app routing. Stale events from earlier input sessions are ignored. Pasted text updates Android's composing text through the existing `setPreeditText` bridge; normal undo updates the same composition.

Alt+number copies the IME's composition buffer or a selection inside that buffer. It does not read selected text from the host app. A slot paste stays in the IME composition until committed through the usual editor flow. Changing host apps or starting a new composition clears the buffer according to existing IME rules but retains the slots. Android WebView DOM storage is enabled already; saved slots live in the app's WebView profile and survive WebView recreation and IME restarts. Clearing app data removes them.

Shortcuts use Ctrl for paste and Alt for copy on every platform. They work with the physical number row and numeric keypad; key-only digit events are also supported. Shift, Meta, AltGraph, combined Ctrl+Alt, and composing events are excluded. Holding a shortcut performs its action once. Shortcuts are handled before steno chord tracking so digits cannot leak into a chord. Text fields and dictionary controls retain their native shortcuts.

Browsers and operating systems sometimes reserve Ctrl+number or Alt+number. V7 prevents browser actions when it receives these shortcuts while in V7 mode. If the operating system intercepts a shortcut first, use the panel buttons. Buttons have slot-specific accessible names, empty slots disable Paste and Clear, and feedback is announced through a live status region. The collapsible list scrolls within a bounded height and wraps its controls on narrow screens. Previews truncate at 120 characters; copying and pasting retain the full text.

## Persistence and clearing

Slots are stored under `v7.clipboard-slots.v1` in localStorage, scoped to this browser profile and site origin. They survive reloads and browser restarts where local storage is available. They are not sent to an OS clipboard or a slot-sync service; pasted text becomes part of the editor buffer and follows its usual inference flow. Do not expect slots to synchronize across devices or open tabs: each page loads its own snapshot and writes all ten slots on changes.

Clear removes the item from the current page and saves the cleared state immediately. Clearing slots is immediate and has no undo. Clearing browser site data also removes saved slots. If storage is blocked or full, the current page remains usable and reports that changes last only for the session. Malformed saved data is ignored safely.

## Implementation and validation

`src/slottedClipboard.ts` owns slot storage, shortcut recognition, and the panel. `src/ime.ts` applies mode and selection policies and inserts fixed islands through the existing buffer and undo manager. The `fixed` island type uses the existing fixed-text inference path, with explicit boundaries to preserve literal text.

Run `npm run test:unit -- --runInBand tests/slottedClipboard.test.ts` for storage, modifier, rendering, inference, and undo coverage. Run `npm run test:clipboard-slots` for Android bridge shortcuts, preedit updates, persistence, clearing, and mode coverage.
