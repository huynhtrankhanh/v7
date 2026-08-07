# Android IME native popup behavior

Native Stripped Plover command dialogs support touch and complete hardware-keyboard navigation. Tab and Shift+Tab cycle through every field, status region, dictionary choice, and action; Escape closes the dialog; Enter submits; and numbered shortcuts plus radio-button arrow navigation select writable dictionaries.

Dictionary choices use full-width 48 dp targets and select on the first tap. When focus leaves an editor for a radio button or action, the IME relinquishes hardware keys to the native activity instead of interpreting them through the former Raw outline editor. In add-translation, Enter advances from outline to translation and then submits.

The IME surface is requested when a popup editor receives focus and remains available as focus moves. Outside touches do not silently dismiss an unfinished form.

Outline fields use Raw outline mode. Translation and lookup-text fields use an explicit plain-text mode, so hardware input reaches the editor and an active Stripped Plover mode is temporarily suppressed.

## Root cause

The popup activity declared `stateAlwaysHidden` while only requesting focus, which prevented the IME surface from appearing on launch. Its editor contract also distinguished only Raw outline fields from default editors. Because Stripped Plover mode persists across editor changes, moving from an outline field into ordinary text resumed that pipeline and captured input intended for the native field. The dialog now requests a visible, resizing IME and marks ordinary popup fields explicitly.

Dictionary keyboard selection remained broken because Android can retain the last `EditText` input connection after focus moves to a native radio button. V7 therefore continued consuming number and navigation keys as Raw outline input before the activity could see them. Native-control focus is now explicit process state: it makes the IME pass hardware events through, while returning to either editor restores that editor's routing mode. The undersized implicit radio interaction was also replaced with an explicit full-row first-tap selection contract.

## Experimental Android ML reranking

The Android IME can optionally rerank KenLM's first 50 candidates with a
user-installed Gemma 3 1B IT model through the native Android LiteRT-LM
runtime before any result reaches the WebUI. It is disabled by default,
on-device, Android-owned, deterministic at the decoding/protocol boundary, and
fail-open to the original 100-candidate KenLM order. It does not add a Retrofit
or other network client and does not move reranker inference into Rust.

KenLM's 3-gram score sees short local context and previously flowed straight to
the app, so locally plausible but sentence-level-incoherent candidates could
remain above stronger alternatives. The optional broader model addresses that
ranking limitation without changing V7 enumeration. Download, research,
storage, licensing, latency, ABI, and validation details are documented in
[`ime-android/docs/experimental-reranking.md`](ime-android/docs/experimental-reranking.md).

LiteRT loading and generation run asynchronously so the WebView can continue
receiving keyboard events. The composition stays visible with an indeterminate
progress bar and explicit loading/ranking/fallback state. New chords cancel an
obsolete ranking. The single model prefers supported device GPUs and falls back
to bounded parallel CPU workers; the app never duplicates the large model
merely to rank requests concurrently.
