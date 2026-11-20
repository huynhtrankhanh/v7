const fs = require("node:fs");
const { buildSync } = require("esbuild");
const { runInNewContext } = require("node:vm");
const { JSDOM } = require("jsdom");
const readline = require("node:readline");
const path = require("node:path");
const bundle = buildSync({
  entryPoints: [path.resolve(__dirname, "../src/ime-sandbox.ts")],
  bundle: true,
  write: false,
  platform: "neutral",
  format: "iife",
  target: "es2020",
}).outputFiles[0].text;
const imeUiBundle = buildSync({
  entryPoints: [path.resolve(__dirname, "../src/ime.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "es2020",
}).outputFiles[0].text;
const imeHtml = fs.readFileSync(
  path.resolve(__dirname, "../static/ime.html"),
  "utf8",
);
const sessions = new Map();
const webviews = new Map();
const telex = {};
runInNewContext(
  buildSync({
    entryPoints: [path.resolve(__dirname, "../src/telex-sandbox.ts")],
    bundle: true,
    write: false,
    platform: "neutral",
    format: "iife",
    target: "es2020",
  }).outputFiles[0].text,
  telex,
);

function installWebViewGeometry(win) {
  const { HTMLElement } = win;
  const origGetComputedStyle = win.getComputedStyle.bind(win);
  win.getComputedStyle = (el) => {
    const style = origGetComputedStyle(el);
    const id = el && el.id;
    const cls = el && el.classList;
    const body = win.document.body;
    const compact =
      body.classList.contains("stripped-plover-active") ||
      body.classList.contains("android-normal-typing") ||
      body.classList.contains("android-telex") ||
      body.classList.contains("android-raw-outline");
    return new Proxy(style, {
      get(target, prop) {
        if (prop === "display") {
          if (id === "workbench") return compact ? "none" : "flex";
          if (id === "plover-suggestion") {
            if (el.hidden || !body.classList.contains("stripped-plover-active"))
              return "none";
            return "flex";
          }
          if (id === "clipboard-slots") return el.hidden ? "none" : "flex";
          if (id === "candidate-area") return el.style.display || "none";
          if (cls && cls.contains("ime-plover-banner"))
            return body.classList.contains("stripped-plover-active")
              ? "flex"
              : "none";
          if (cls && cls.contains("ime-normal-banner"))
            return body.classList.contains("android-normal-typing")
              ? "flex"
              : "none";
          if (cls && cls.contains("ime-telex-banner"))
            return body.classList.contains("android-telex") ? "flex" : "none";
          if (cls && cls.contains("ime-raw-outline-banner"))
            return body.classList.contains("android-raw-outline")
              ? "flex"
              : "none";
          if (cls && cls.contains("ime-composition-label")) return "flex";
        }
        if (prop === "paddingTop") {
          if (id === "workbench") return "9px";
          if (id === "text-display") return "3px";
        }
        if (prop === "paddingBottom") {
          if (id === "workbench") return "8px";
          if (id === "text-display") return "7px";
        }
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      const body = win.document.body;
      if (this.id === "clipboard-slots") return this.hidden ? 0 : 53;
      if (this.id === "plover-suggestion") {
        if (this.hidden || !body.classList.contains("stripped-plover-active"))
          return 0;
        return 40;
      }
      if (this.classList.contains("ime-toolbar")) return 44;
      if (this.classList.contains("ime-composition-label")) return 14;
      if (this.id === "inference-error") return this.hidden ? 0 : 28;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      if (this.classList.contains("text-display-flow")) {
        if (this.classList.contains("empty-text-display-flow")) return 32;
        const len = (this.textContent || "").length;
        return Math.max(32, 32 * Math.ceil(Math.max(1, len) / 24));
      }
      if (this.id === "candidate-area") {
        if (this.style.display === "none") return 0;
        const count = this.querySelectorAll(".candidate").length;
        return count === 0 ? 0 : 41 + 40 * Math.floor((count - 1) / 3);
      }
      return 0;
    },
  });
}

function createWebViewHost(initialBridge) {
  let bridge = { ...initialBridge };
  const heights = [];
  const ploverRequests = [];
  let rafId = 1;
  const rafs = new Map();
  // Strip <script src="script.js"></script> so we inject our freshly built bundle.
  const html = imeHtml.replace(/<script\s+src="script\.js"><\/script>/, "");
  const dom = new JSDOM(html, {
    url: "file:///android_asset/ime.html",
    runScripts: "dangerously",
    beforeParse(win) {
      win.console = { log() {}, info() {}, warn() {}, error() {} };
      win.requestAnimationFrame = (cb) => {
        const id = rafId++;
        rafs.set(id, cb);
        return id;
      };
      win.cancelAnimationFrame = (id) => {
        rafs.delete(id);
      };
      win.AndroidIme = {
        isSandboxInputEnabled: () => !!bridge.sandboxInputEnabled,
        getInputSnapshot: () => bridge.inputSnapshot ?? "",
        getPloverSuggestion: () => bridge.ploverSuggestion ?? "null",
        submitInputCommand: () => {},
        getClipboardSlots: () => bridge.clipboardSlots ?? "[]",
        setClipboardSlot: () => true,
        migrateClipboardSlots: () => false,
        showClipboardMessage: () => {},
        hasPloverConfiguration: () => true,
        isPloverPaused: () => !!bridge.ploverPaused,
        getInferenceModelState: () => bridge.inferenceModelState ?? "ready",
        getInferenceModelError: () => bridge.inferenceModelError ?? "",
        isStenoModeEnabled: () => !!bridge.stenoModeEnabled,
        isTelexModeEnabled: () => !!bridge.telexModeEnabled,
        isTelexReady: () => !!bridge.telexReady,
        getInputGeneration: () => bridge.inputGeneration ?? 0,
        isRawOutlineMode: () => !!bridge.rawOutlineMode,
        isPlainTextMode: () => !!bridge.plainTextMode,
        isPloverEnabled: () => !!bridge.ploverEnabled,
        getDisplayRevision: () => bridge.displayRevision ?? 0,
        setKeyboardHeight: (heightDp) => {
          heights.push(heightDp);
        },
        requestPlover: (body, requestId) => {
          ploverRequests.push({ body, requestId });
        },
        changeInputMethod: () => {},
      };
    },
  });
  installWebViewGeometry(dom.window);
  const scriptEl = dom.window.document.createElement("script");
  scriptEl.textContent = imeUiBundle;
  dom.window.document.body.appendChild(scriptEl);
  function inspect() {
    const doc = dom.window.document;
    const body = doc.body;
    const textClone = doc.getElementById("text-display")?.cloneNode(true);
    textClone?.querySelectorAll(".piecemeal-number").forEach((n) => n.remove());
    const textContent = textClone ? textClone.textContent : "";
    const row = doc.getElementById("plover-suggestion");
    const clipboard = doc.getElementById("clipboard-slots");
    const candArea = doc.getElementById("candidate-area");
    const infError = doc.getElementById("inference-error");
    const modes = [];
    if (body.classList.contains("android-raw-outline"))
      modes.push("raw-outline");
    if (body.classList.contains("android-telex")) modes.push("telex");
    if (body.classList.contains("android-normal-typing")) modes.push("normal");
    if (body.classList.contains("stripped-plover-active")) modes.push("plover");
    return {
      modes,
      bodyClasses: [...body.classList].sort(),
      telexDegraded: body.classList.contains("android-telex-degraded"),
      ploverPausedClass: body.classList.contains("stripped-plover-paused"),
      ploverStatus: doc.getElementById("plover-status")?.textContent ?? "",
      ploverBanner:
        doc.querySelector(".ime-plover-banner strong")?.textContent ?? "",
      telexBanner:
        doc.querySelector(".ime-telex-banner strong")?.textContent ?? "",
      inferenceStatus:
        doc.getElementById("inference-status")?.textContent ?? "",
      inferenceStatusClass:
        doc.getElementById("inference-status")?.className ?? "",
      inferenceErrorHidden: infError ? infError.hidden : true,
      inferenceError: infError ? infError.textContent : "",
      textDisplay: textContent,
      candidatesVisible: candArea ? candArea.style.display !== "none" : false,
      candidateCount: candArea
        ? candArea.querySelectorAll(".candidate").length
        : 0,
      clipboardHidden: clipboard ? clipboard.hidden : true,
      clipboardVisibleCount: clipboard
        ? [...clipboard.querySelectorAll("button")].filter((b) => !b.hidden)
            .length
        : 0,
      suggestionHidden: row ? row.hidden : true,
      suggestionVisible:
        !!row &&
        !row.hidden &&
        body.classList.contains("stripped-plover-active"),
      suggestionOffsetHeight: row ? row.offsetHeight : 0,
      suggestionTranslation:
        row?.querySelector(".plover-suggestion-text")?.textContent ?? null,
      suggestionStrokes: row
        ? [...row.querySelectorAll("code")].map((c) => c.textContent)
        : [],
      pendingRafs: rafs.size,
      heights: heights.splice(0),
      ploverRequests: ploverRequests.splice(0),
    };
  }
  return {
    setBridge(next) {
      bridge = { ...next };
    },
    evalScript(script) {
      dom.window.eval(script);
      return inspect();
    },
    runRaf() {
      const batch = [...rafs.entries()];
      rafs.clear();
      for (const [, cb] of batch) cb(Date.now());
      return inspect();
    },
    inspect,
    close() {
      rafs.clear();
      dom.window.close();
    },
  };
}

let tail = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  tail = tail.then(async () => {
    try {
      const call = JSON.parse(line);
      if (Object.hasOwn(call, "webview")) {
        if (call.webview === "create") {
          const host = createWebViewHost(call.bridge);
          webviews.set(call.id, host);
          process.stdout.write(JSON.stringify(host.inspect()) + "\n");
          return;
        }
        const host = webviews.get(call.id);
        if (!host) {
          process.stdout.write(JSON.stringify({ closed: true }) + "\n");
          return;
        }
        if (call.bridge) host.setBridge(call.bridge);
        if (call.webview === "eval") {
          process.stdout.write(
            JSON.stringify(host.evalScript(call.script)) + "\n",
          );
        } else if (call.webview === "raf") {
          process.stdout.write(JSON.stringify(host.runRaf()) + "\n");
        } else if (call.webview === "state") {
          process.stdout.write(JSON.stringify(host.inspect()) + "\n");
        } else if (call.webview === "close") {
          host.close();
          webviews.delete(call.id);
          process.stdout.write("{}\n");
        }
        return;
      }
      if (Object.hasOwn(call, "telex")) {
        process.stdout.write(
          JSON.stringify({ text: telex.convertV7TelexRaw(call.telex) }) + "\n",
        );
        return;
      }
      if (call.close) {
        sessions.delete(call.session);
        process.stdout.write("{}\n");
        return;
      }
      let protocol = sessions.get(call.session);
      if (!protocol) {
        const global = { console: { log() {}, error() {} } };
        runInNewContext(bundle, global);
        protocol = global.v7Input;
        sessions.set(call.session, protocol);
      }
      let timer;
      const task = call.command
        ? protocol.dispatch(call.command)
        : protocol.reply(call.id, call.value, call.error || "");
      const packet = await Promise.race([
        task,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Sandbox packet stalled for four seconds")),
            4000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      process.stdout.write(packet + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({ hostError: String(error) }) + "\n");
    }
  });
});
