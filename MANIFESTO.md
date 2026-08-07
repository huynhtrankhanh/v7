# Android IME native popup behavior

Native Stripped Plover command dialogs support touch and complete hardware-keyboard navigation. Tab and Shift+Tab cycle through every field, status region, dictionary choice, and action; Escape closes the dialog; Enter submits; and numbered shortcuts plus radio-button arrow navigation select writable dictionaries.

The IME surface is requested when a popup editor receives focus and remains available as focus moves. Outside touches do not silently dismiss an unfinished form.

Outline fields use Raw outline mode. Translation and lookup-text fields use an explicit plain-text mode, so hardware input reaches the editor and an active Stripped Plover mode is temporarily suppressed.

## Root cause

The popup activity declared `stateAlwaysHidden` while only requesting focus, which prevented the IME surface from appearing on launch. Its editor contract also distinguished only Raw outline fields from default editors. Because Stripped Plover mode persists across editor changes, moving from an outline field into ordinary text resumed that pipeline and captured input intended for the native field. The dialog now requests a visible, resizing IME and marks ordinary popup fields explicitly.
