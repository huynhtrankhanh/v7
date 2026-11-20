#!/usr/bin/env node
/**
 * Real-Chromium Puppeteer fuzzer for the Android IME WebView surface.
 *
 * Exercises the real built static/ime.html + static/ime.css + static/script.js
 * together with the real src/ime-sandbox.ts protocol, resizing the Chromium
 * viewport whenever AndroidIme.setKeyboardHeight() is called so real CSS flex,
 * 100dvh, media queries, resize events, and requestAnimationFrame ticks run.
 *
 * Checks:
 *  1. No rapid layout jump (multi-step height oscillation) in response to one
 *     action — including Stripped Plover strokes while loading suggestions,
 *     mode switches (V7 / Plover / Normal / Telex / Raw Outline), editor
 *     switches, clipboard updates, and WebView reloads.
 *  2. No stale WebView state after settling (mode classes, banners, text,
 *     candidates, clipboard slots, Plover pause/status, suggestion row, height).
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { buildSync } = require("esbuild");
const { runInNewContext } = require("node:vm");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const STATIC_DIR = path.join(ROOT, "static");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    const requested = pathname === "/" ? "/ime.html" : pathname;
    const file = path.normalize(path.join(STATIC_DIR, requested));
    if (!file.startsWith(`${STATIC_DIR}${path.sep}`)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": file.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : file.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/html; charset=utf-8",
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function createSandboxIsolate() {
  const bundle = buildSync({
    entryPoints: [path.join(ROOT, "src/ime-sandbox.ts")],
    bundle: true,
    write: false,
    platform: "neutral",
    format: "iife",
    target: "es2020",
  }).outputFiles[0].text;
  const global = { console: { log() {}, error() {} } };
  runInNewContext(bundle, global);
  return global.v7Input;
}

const SUGGESTION_TABLE = {
  video: ["V-D"],
  chào: ["KAU"],
  "xin chào": ["A", "SW", "SWAU", "SKWAU"],
  "don't": ["TKOPBT"],
  "test-case": ["TEFT/KAES", "TEFT/KAEZ/LONG/OUTLINE/EXTRA"],
  unmatched: null,
};

async function runSeed(browser, url, seed, steps) {
  const rand = mulberry32(seed);
  const nextInt = (n) => Math.floor(rand() * n);
  const nextBool = () => rand() < 0.5;
  const isolate = createSandboxIsolate();
  const widths = [280, 360, 412, 520];
  const viewportWidth = widths[seed % widths.length];

  // Authoritative native service state mirroring V7ImeService.
  const native = {
    epoch: 1,
    steno: true,
    telex: false,
    telexReady: true,
    rawOutline: false,
    ploverPaused: false,
    ploverAvailable: true,
    ploverEnabled: false,
    modelState: "ready",
    modelError: "",
    slots: Array(10).fill(null),
    inputSnapshot: "",
    ploverSuggestion: "null",
    ploverSuggestionPending: false,
    displayRevision: 0,
  };

  function context() {
    return {
      epoch: native.epoch,
      steno: native.steno,
      telex: native.telex,
      telexReady: native.telexReady,
      rawOutline: native.rawOutline,
      ploverPaused: native.ploverPaused,
      ploverAvailable: native.ploverAvailable,
      modelState: native.modelState,
      modelError: native.modelError,
      slots: native.slots.slice(),
    };
  }

  let page = null;
  let currentHeight = 160;
  let heightEvents = [];

  async function syncBridgeToPage() {
    if (!page) return;
    await page.evaluate(
      (state) => {
        window.__nativeBridge = state;
      },
      { ...native },
    );
  }

  async function applyViewportHeight(height) {
    if (!page || !height || height === currentHeight) return;
    currentHeight = height;
    await page.setViewport({
      width: viewportWidth,
      height,
      deviceScaleFactor: 1,
    });
  }

  async function drainHeightAndRafs() {
    for (let i = 0; i < 6; i++) {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const requested = await page.evaluate(() =>
        window.__requestedHeights.splice(0),
      );
      if (requested.length === 0) break;
      for (const h of requested) {
        if (
          heightEvents.length === 0 ||
          heightEvents[heightEvents.length - 1] !== h
        ) {
          heightEvents.push(h);
        }
        await applyViewportHeight(h);
      }
    }
  }

  async function loadFreshWebView() {
    if (page) await page.close();
    page = await browser.newPage();
    currentHeight = 160;
    await page.setViewport({
      width: viewportWidth,
      height: currentHeight,
      deviceScaleFactor: 1,
    });
    await page.evaluateOnNewDocument(
      (initial) => {
        window.__nativeBridge = initial;
        window.__requestedHeights = [];
        window.AndroidIme = {
          isSandboxInputEnabled: () => true,
          getInputSnapshot: () => window.__nativeBridge.inputSnapshot,
          getPloverSuggestion: () => window.__nativeBridge.ploverSuggestion,
          isPloverEnabled: () => window.__nativeBridge.ploverEnabled,
          getDisplayRevision: () => window.__nativeBridge.displayRevision,
          submitInputCommand: () => {},
          getClipboardSlots: () => JSON.stringify(window.__nativeBridge.slots),
          setClipboardSlot: () => true,
          migrateClipboardSlots: () => false,
          showClipboardMessage: () => {},
          hasPloverConfiguration: () => true,
          isPloverPaused: () => window.__nativeBridge.ploverPaused,
          getInferenceModelState: () => window.__nativeBridge.modelState,
          getInferenceModelError: () => window.__nativeBridge.modelError,
          isStenoModeEnabled: () => window.__nativeBridge.steno,
          isTelexModeEnabled: () => window.__nativeBridge.telex,
          isTelexReady: () => window.__nativeBridge.telexReady,
          getInputGeneration: () => window.__nativeBridge.epoch,
          isRawOutlineMode: () => window.__nativeBridge.rawOutline,
          isPlainTextMode: () => false,
          setKeyboardHeight: (heightDp) => {
            window.__requestedHeights.push(heightDp);
          },
          requestPlover: () => {},
          changeInputMethod: () => {},
        };
      },
      { ...native },
    );
    await page.goto(`${url}/ime.html`, { waitUntil: "load" });
    await syncBridgeToPage();
    await page.evaluate(() => {
      window.syncAndroidDisplayState && window.syncAndroidDisplayState();
    });
    await drainHeightAndRafs();
  }

  async function pushSnapshotPacket(packet, { ploverWord = "video" } = {}) {
    let current = packet;
    while (true) {
      const inferEffect = (current.effects || []).find(
        (e) => e.type === "infer",
      );
      if (inferEffect) {
        // Mirror V7ImeService: hold intermediate raw-V7 display snapshot until sync infer finishes.
        const islands = JSON.parse(inferEffect.body).islands;
        const main = islands.map((i) =>
          i.kind === "fixed" ? i.text : "chính thức",
        );
        const alt1 = islands.map((i) =>
          i.kind === "fixed" ? i.text : "mở rộng",
        );
        const alt2 = islands.map((i) =>
          i.kind === "fixed" ? i.text : "phát triển",
        );
        current = JSON.parse(
          await isolate.reply(inferEffect.id, {
            candidates: [main, alt1, alt2],
          }),
        );
        continue;
      }
      const ploverEffect = (current.effects || []).find(
        (e) => e.type === "plover",
      );
      if (ploverEffect) {
        const reply =
          ploverEffect.method === "translate"
            ? {
                output: ploverWord
                  ? [{ type: "preedit", text: ploverWord }]
                  : [],
              }
            : { output: [] };
        current = JSON.parse(await isolate.reply(ploverEffect.id, reply));
        continue;
      }
      break;
    }
    if (current.snapshot && current.snapshot.epoch === native.epoch) {
      const nextStr = JSON.stringify(current.snapshot);
      if (nextStr !== native.inputSnapshot) {
        native.inputSnapshot = nextStr;
        native.ploverEnabled = !!current.snapshot.ploverEnabled;
        native.displayRevision += 1;
        await syncBridgeToPage();
        await page.evaluate(
          ({ snapshot, rev }) => {
            window.handleAndroidInputSnapshot(snapshot, rev);
          },
          { snapshot: current.snapshot, rev: native.displayRevision },
        );
      }
    }
    return current;
  }

  async function dispatch(type, data = {}, options = {}) {
    const packet = JSON.parse(
      await isolate.dispatch({ type, context: context(), ...data }),
    );
    return pushSnapshotPacket(packet, options);
  }

  async function chord(keys, options = {}) {
    let packet;
    for (const k of keys) {
      packet = await dispatch(
        "key",
        {
          event: {
            action: "keydown",
            key: k,
            code: k === " " ? "Space" : `Key${k.toUpperCase()}`,
            repeat: false,
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            capsLock: false,
            epoch: native.epoch,
          },
        },
        options,
      );
    }
    for (const k of keys) {
      packet = await dispatch(
        "key",
        {
          event: {
            action: "keyup",
            key: k,
            code: k === " " ? "Space" : `Key${k.toUpperCase()}`,
            repeat: false,
            shiftKey: false,
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            capsLock: false,
            epoch: native.epoch,
          },
        },
        options,
      );
    }
    return packet;
  }

  async function publishSuggestion(suggestionObj, pending) {
    const serialized = suggestionObj ? JSON.stringify(suggestionObj) : "null";
    if (
      serialized === native.ploverSuggestion &&
      pending === native.ploverSuggestionPending
    )
      return;
    native.ploverSuggestion = serialized;
    native.ploverSuggestionPending = pending;
    native.displayRevision += 1;
    await syncBridgeToPage();
    await page.evaluate(
      ({ suggestion, pending, rev }) => {
        window.handleAndroidPloverSuggestion(suggestion, pending, rev);
      },
      { suggestion: suggestionObj, pending, rev: native.displayRevision },
    );
  }

  async function assertWebViewMatches(contextLabel) {
    const dom = await page.evaluate(() => {
      const body = document.body;
      const modes = [];
      if (body.classList.contains("android-raw-outline"))
        modes.push("raw-outline");
      if (body.classList.contains("android-telex")) modes.push("telex");
      if (body.classList.contains("android-normal-typing"))
        modes.push("normal");
      if (body.classList.contains("stripped-plover-active"))
        modes.push("plover");
      const row = document.getElementById("plover-suggestion");
      const clipboard = document.getElementById("clipboard-slots");
      const candArea = document.getElementById("candidate-area");
      return {
        modes,
        telexDegraded: body.classList.contains("android-telex-degraded"),
        ploverPausedClass: body.classList.contains("stripped-plover-paused"),
        clipboardHidden: clipboard.hidden,
        clipboardHeight: clipboard.offsetHeight,
        suggestionVisible:
          !row.hidden && getComputedStyle(row).display !== "none",
        suggestionHeight: row.offsetHeight,
        suggestionTranslation:
          row.querySelector(".plover-suggestion-text")?.textContent ?? null,
        candidatesVisible: getComputedStyle(candArea).display !== "none",
        candidatesOverflow: candArea.scrollHeight > candArea.clientHeight + 1,
        viewportHeight: window.innerHeight,
      };
    });
    assert(
      dom.modes.length <= 1,
      `Multiple compact mode classes (${dom.modes.join(",")}) ${contextLabel}`,
    );
    const expectedMode = native.rawOutline
      ? "raw-outline"
      : native.telex
        ? "telex"
        : !native.steno
          ? "normal"
          : native.ploverEnabled
            ? "plover"
            : "v7";
    const actualMode = dom.modes[0] || "v7";
    assert(
      actualMode === expectedMode,
      `Stale WebView mode expected=${expectedMode} actual=${actualMode} ${contextLabel}`,
    );
    if (expectedMode === "telex") {
      assert(
        dom.telexDegraded === !native.telexReady,
        `Stale Telex degraded class ${contextLabel}`,
      );
    }
    assert(
      dom.ploverPausedClass === native.ploverPaused,
      `Stale Plover paused class ${contextLabel}`,
    );
    const expectedSuggestion =
      expectedMode === "plover" &&
      !native.ploverPaused &&
      native.ploverSuggestion !== "null"
        ? JSON.parse(native.ploverSuggestion)
        : null;
    assert(
      dom.suggestionVisible === Boolean(expectedSuggestion),
      `Stale suggestion visibility expected=${Boolean(expectedSuggestion)} actual=${dom.suggestionVisible} ${contextLabel}`,
    );
    if (expectedSuggestion) {
      assert(
        dom.suggestionTranslation === expectedSuggestion.translation,
        `Stale suggestion translation expected=${expectedSuggestion.translation} actual=${dom.suggestionTranslation} ${contextLabel}`,
      );
      assert(
        dom.suggestionHeight === 40,
        `Suggestion row height was ${dom.suggestionHeight}, expected 40 ${contextLabel}`,
      );
    }
    if (expectedMode !== "v7") {
      const expectedHeight = 48 + dom.clipboardHeight + dom.suggestionHeight;
      assert(
        currentHeight === expectedHeight,
        `Wrong compact height expected=${expectedHeight} actual=${currentHeight} ${contextLabel} dom=${JSON.stringify(dom)}`,
      );
    } else {
      assert(
        currentHeight >= 112,
        `Wrong V7 height=${currentHeight} ${contextLabel}`,
      );
    }
  }

  try {
    // Initialize sandbox snapshot & load WebView.
    const initial = JSON.parse(
      await isolate.dispatch({ type: "refresh", context: context() }),
    );
    native.inputSnapshot = JSON.stringify(initial.snapshot);
    await loadFreshWebView();

    const words = Object.keys(SUGGESTION_TABLE);
    const history = [];

    for (let step = 0; step < steps; step++) {
      await drainHeightAndRafs();
      heightEvents = [currentHeight];

      const action = nextInt(12);
      history.push(`step=${step}:a=${action}`);
      const label = `seed=${seed} width=${viewportWidth} step=${step} action=${action} history=${history.join(",")}`;

      if (action === 0 && native.steno && !native.rawOutline) {
        // Toggle Stripped Plover (#)
        await chord(["q"]);
        if (!native.ploverEnabled || native.ploverPaused) {
          await publishSuggestion(null, false);
        }
        await drainHeightAndRafs();
      } else if (action === 1) {
        // Ctrl+Shift (Steno <-> Normal)
        native.steno = !native.steno;
        native.telex = false;
        native.epoch += 1;
        await dispatch("clear");
        if (!native.steno || !native.ploverEnabled || native.ploverPaused) {
          await publishSuggestion(null, false);
        }
        await drainHeightAndRafs();
      } else if (action === 2) {
        // Ctrl+Tab (Telex <-> V7/Plover)
        if (native.telex) {
          native.telex = false;
          native.steno = true;
        } else {
          native.telex = true;
          native.steno = false;
        }
        native.epoch += 1;
        await dispatch("clear");
        if (!native.steno || !native.ploverEnabled || native.ploverPaused) {
          await publishSuggestion(null, false);
        }
        await drainHeightAndRafs();
      } else if (action === 3 || action === 4) {
        // Input a stroke! Heavily exercise Stripped Plover suggestion loading & V7 chords.
        if (
          native.steno &&
          !native.rawOutline &&
          native.ploverEnabled &&
          !native.ploverPaused
        ) {
          const word = words[nextInt(words.length)];
          await chord(["a"], { ploverWord: word });
          // Phase 1: scanEditor starts lookup -> publishes pending=true
          await publishSuggestion(null, true);
          await drainHeightAndRafs();
          // Phase 2: 120ms later, reverse_lookup resolves (hit or miss)
          const strokes = SUGGESTION_TABLE[word];
          await publishSuggestion(
            strokes ? { translation: word, strokes } : null,
            false,
          );
          await drainHeightAndRafs();
        } else if (
          native.steno &&
          !native.rawOutline &&
          !native.ploverEnabled
        ) {
          await chord(["c", " ", "m"]);
          await drainHeightAndRafs();
        }
      } else if (action === 5) {
        // Switch Raw Outline mode on/off
        native.rawOutline = !native.rawOutline;
        native.epoch += 1;
        await dispatch("clear");
        if (native.rawOutline) await publishSuggestion(null, false);
        await drainHeightAndRafs();
      } else if (action === 6) {
        // Toggle clipboard slot
        native.slots[0] = nextBool() ? "xin chào" : null;
        await dispatch("refresh");
        await drainHeightAndRafs();
      } else if (action === 7) {
        // Toggle Plover paused
        native.ploverPaused = !native.ploverPaused;
        if (native.ploverPaused) await publishSuggestion(null, false);
        await dispatch("refresh");
        await drainHeightAndRafs();
      } else if (action === 8) {
        // Toggle Telex ready
        native.telexReady = !native.telexReady;
        await dispatch("refresh");
        await drainHeightAndRafs();
      } else if (action === 9) {
        // Recreate WebView (must jump at most once to exact final height)
        const prior = currentHeight;
        await loadFreshWebView();
        // Reset trace against what the fresh WebView itself emitted (must be 1 height, no bounce!)
        const freshHeights = heightEvents.slice(1);
        assert(
          freshHeights.length <= 1,
          `Fresh WebView jumped multiple times on load: ${JSON.stringify(freshHeights)} (prior=${prior}) ${label}`,
        );
        heightEvents = [prior, ...freshHeights];
      } else if (action === 10) {
        // Deliver a stale out-of-order revision (e.g. delayed Mojo IPC across mode change)
        const staleRev = Math.max(0, native.displayRevision - 1);
        await page.evaluate(
          ({ rev, epoch }) => {
            window.handleAndroidStenoModeChanged(false, true, epoch, rev);
            window.handleAndroidPloverSuggestion(
              { translation: "stale", strokes: ["STAEUL"] },
              false,
              rev,
            );
          },
          { rev: staleRev, epoch: native.epoch },
        );
        await drainHeightAndRafs();
      } else if (action === 11) {
        // Toggle inference error state (exercises #inference-error height + V7 -> compact -> V7)
        if (native.modelState === "error") {
          native.modelState = "ready";
          native.modelError = "";
        } else {
          native.modelState = "error";
          native.modelError = "Injected model error";
        }
        await dispatch("refresh");
        await drainHeightAndRafs();
      }

      assert(
        heightEvents.length <= 2,
        `Rapid layout jump in real Chromium for ONE action: heights=${JSON.stringify(heightEvents)} ${label}`,
      );
      await assertWebViewMatches(label);
    }
  } finally {
    if (page) await page.close();
  }
}

async function main() {
  const seeds = Number(process.env.V7_WEBVIEW_FUZZ_SEEDS || 12);
  const steps = Number(process.env.V7_WEBVIEW_FUZZ_STEPS || 35);
  const { server, url } = await startStaticServer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    for (let seed = 0; seed < seeds; seed++) {
      await runSeed(browser, url, seed, steps);
    }
    console.log(
      `Real-Chromium WebView layout & staleness fuzz passed (${seeds} seeds x ${steps} steps)`,
    );
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
