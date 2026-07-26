// Bridges the shared V7 web UI (built from `src/` into `static/script.js`)
// to the macOS Input Method's native Swift code.
//
// `script.js` already knows how to talk to a native host: it feature-detects
// `window.AndroidIme` (see the `AndroidImeBridge` interface and `androidIme`
// constant near the top of `src/main.ts`) and, when present, routes
// inference, preedit/composing-text updates, and mode state through it
// instead of doing a same-origin `fetch("/infer")` or rendering an on-screen
// keyboard. Defining `window.AndroidIme` here — with the exact same method
// names Android's `AndroidBridge` exposes via `addJavascriptInterface` — lets
// this macOS IME reuse the web UI with zero changes to `src/`.
//
// WKScriptMessageHandler communication is one-directional and asynchronous
// (there is no WKWebView equivalent of Android's synchronous
// `@JavascriptInterface` calls), but a few AndroidImeBridge methods
// (`getInferenceModelState`, `getInferenceModelError`, `isStenoModeEnabled`,
// `isRawOutlineMode`, `isPloverPaused`, `hasPloverConfiguration`) are called
// as plain synchronous getters. We resolve that by keeping a small
// native-authoritative cache (`__v7MacBridgeState`) that native code updates
// via `evaluateJavaScript` pushes (mirroring the existing
// `window.handleAndroidInferenceState` / `handleAndroidStenoModeChanged` /
// `handleAndroidRawOutlineModeChanged` push callbacks Android already uses),
// and have the getters simply read that cache synchronously.
(function () {
  "use strict";

  var state = {
    inferenceModelState: "not_loaded",
    inferenceModelError: "",
    stenoModeEnabled: true,
    // Stripped Plover and raw-outline mode are out of scope for v1 of the
    // macOS IME (see ime-macos/README.md "Known limitations"), so these stay
    // constant rather than participating in the push-update cache.
    rawOutlineMode: false,
    ploverPaused: true,
  };

  function post(message) {
    window.webkit.messageHandlers.v7ime.postMessage(message);
  }

  window.AndroidIme = {
    getInferenceModelState: function () {
      return state.inferenceModelState;
    },
    getInferenceModelError: function () {
      return state.inferenceModelError;
    },
    hasPloverConfiguration: function () {
      return false;
    },
    isPloverPaused: function () {
      return state.ploverPaused;
    },
    isRawOutlineMode: function () {
      return state.rawOutlineMode;
    },
    isStenoModeEnabled: function () {
      return state.stenoModeEnabled;
    },
    changeInputMethod: function () {
      post({ type: "changeInputMethod" });
    },
    requestInference: function (body, requestId) {
      post({ type: "requestInference", body: body, requestId: requestId });
    },
    requestPlover: function (body, requestId) {
      // Stripped Plover is not bundled in the macOS IME yet; fail the
      // request immediately instead of hanging until the 180s client
      // timeout in src/main.ts's requestAndroidPlover.
      window.handleAndroidPloverResponse &&
        window.handleAndroidPloverResponse(
          requestId,
          "",
          "Stripped Plover is not available in the macOS IME yet.",
        );
    },
    setPreeditText: function (text, grammarSectionsJson) {
      post({
        type: "setPreeditText",
        text: text,
        grammarSectionsJson: grammarSectionsJson,
      });
    },
    setKeyboardHeight: function (heightDp) {
      post({ type: "setKeyboardHeight", heightDp: heightDp });
    },
    undoRawOutlineStroke: function () {
      post({ type: "undoRawOutlineStroke" });
    },
  };

  // Native calls these after pushing a new value into the cache, exactly
  // mirroring the shape of Android's existing handleAndroid* callbacks.
  window.__v7MacBridgeState = state;
})();
