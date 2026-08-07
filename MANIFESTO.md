# Android IME native popup behavior

Native Stripped Plover command dialogs support touch and complete hardware-keyboard navigation. Tab and Shift+Tab cycle through every field, status region, dictionary choice, and action; Escape closes the dialog; Enter submits; and numbered shortcuts plus radio-button arrow navigation select writable dictionaries.

Dictionary choices use full-width 48 dp targets and select on the first tap. When focus leaves an editor for a radio button or action, the IME relinquishes dialog-navigation keys to the native activity instead of interpreting them through the former Raw outline editor. V7's Ctrl+Shift mode chord remains owned by the IME. In add-translation, Enter advances from outline to translation and then submits.

The IME surface is requested when a popup editor receives focus and remains available as focus moves. Outside touches do not silently dismiss an unfinished form.

Outline fields use Raw outline mode. Translation and lookup-text fields use standard V7 behavior and preserve the user's STENO/Normal selection; the dialog never forces Normal typing.

## Root cause

The popup activity declared `stateAlwaysHidden` while only requesting focus, which prevented the IME surface from appearing on launch. It later overcorrected by tagging translation fields as forced plain text, suppressing standard V7 and its Ctrl+Shift mode control. The dialog now requests a visible, resizing IME, marks only outline editors specially, and otherwise leaves the persistent user mode untouched.

Dictionary keyboard selection remained broken because Android can retain the last `EditText` input connection after focus moves to a native radio button. V7 therefore continued consuming number and navigation keys as Raw outline input before the activity could see them. Native-control focus is now explicit process state: it makes the IME pass hardware events through, while returning to either editor restores that editor's routing mode. The undersized implicit radio interaction was also replaced with an explicit full-row first-tap selection contract.

## Experimental Android ML reranking

The Android IME can optionally rescore a configurable 2–100 leading KenLM
candidates with a user-installed Gemma 3 1B IT model. Rust calls LiteRT-LM's
native C scoring API and orders by normalized token log-likelihood before any
result reaches the WebUI, which still displays only five. It is disabled by
default, fully on-device, and fail-open to the original KenLM order. There is
no Kotlin LiteRT engine, prompted ordinal generation, Retrofit, or network
client.

KenLM's 3-gram score sees short local context and previously flowed straight to
the app, so locally plausible but sentence-level-incoherent candidates could
remain above stronger alternatives. The optional broader model addresses that
ranking limitation without changing V7 enumeration. Download, research,
storage, licensing, latency, ABI, and validation details are documented in
[`ime-android/docs/experimental-reranking.md`](ime-android/docs/experimental-reranking.md).

LiteRT loading and scoring run asynchronously so the WebView can continue
receiving keyboard events. The composition stays visible with an indeterminate
progress bar and explicit loading/ranking/fallback state. New chords cancel an
obsolete ranking. The single model prefers supported device GPUs and falls back
to bounded parallel CPU workers; the app never duplicates the large model
merely to rank requests concurrently.

The opt-in model starts loading when the IME service starts. Each request
prefills the candidates' complete shared prefix once into an isolated KV cache,
then scores every selected continuation in one native batch. Gemma replaces
KenLM's order inside that pool; lower candidates stay stable. The app packages
official 64-bit GPU/OpenCL/WebGPU accelerators, prefers GPU, and retries on the
parallel CPU backend when necessary.
