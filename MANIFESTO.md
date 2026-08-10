# Android IME native popup behavior

Native Stripped Plover command dialogs support touch and complete hardware-keyboard navigation. Tab and Shift+Tab cycle through every field, status region, dictionary choice, and action; Escape closes the dialog; Enter submits; and numbered shortcuts plus radio-button arrow navigation select writable dictionaries.

Dictionary choices use full-width 48 dp targets and select on the first tap. When focus leaves an editor for a radio button or action, the IME relinquishes dialog-navigation keys to the native activity instead of interpreting them through the former Raw outline editor. V7's Ctrl+Shift mode chord remains owned by the IME. In add-translation, Enter advances from outline to translation and then submits.

The IME surface is requested when a popup editor receives focus and remains available as focus moves. Outside touches do not silently dismiss an unfinished form.

Outline fields use Raw outline mode. Translation and lookup-text fields use standard V7 behavior and preserve the user's STENO/Normal selection; the dialog never forces Normal typing.

## Root cause

The popup activity declared `stateAlwaysHidden` while only requesting focus, which prevented the IME surface from appearing on launch. It later overcorrected by tagging translation fields as forced plain text, suppressing standard V7 and its Ctrl+Shift mode control. The dialog now requests a visible, resizing IME, marks only outline editors specially, and otherwise leaves the persistent user mode untouched.

Dictionary keyboard selection remained broken because Android can retain the last `EditText` input connection after focus moves to a native radio button. V7 therefore continued consuming number and navigation keys as Raw outline input before the activity could see them. Native-control focus is now explicit process state: it makes the IME pass hardware events through, while returning to either editor restores that editor's routing mode. The undersized implicit radio interaction was also replaced with an explicit full-row first-tap selection contract.
