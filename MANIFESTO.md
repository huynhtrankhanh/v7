# Android IME native popup behavior

Native Stripped Plover command dialogs support touch and complete hardware-keyboard navigation. Tab and Shift+Tab cycle through every field, status region, dictionary choice, and action; Escape closes the dialog; Enter submits; and numbered shortcuts plus radio-button arrow navigation select writable dictionaries.

The IME surface is requested when a popup editor receives focus and remains available as focus moves. Outside touches do not silently dismiss an unfinished form.

Outline fields use Raw outline mode. Translation and lookup-text fields use an explicit plain-text mode, so hardware input reaches the editor and an active Stripped Plover mode is temporarily suppressed.

## Root cause

The popup activity declared `stateAlwaysHidden` while only requesting focus, which prevented the IME surface from appearing on launch. Its editor contract also distinguished only Raw outline fields from default editors. Because Stripped Plover mode persists across editor changes, moving from an outline field into ordinary text resumed that pipeline and captured input intended for the native field. The dialog now requests a visible, resizing IME and marks ordinary popup fields explicitly.

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
