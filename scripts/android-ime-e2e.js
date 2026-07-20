#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const STATIC_DIR = path.join(ROOT, "static");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startStaticServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const pathname = new URL(req.url || "/", "http://localhost").pathname;
    const requested = pathname === "/" ? "/index.html" : pathname;
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
      resolve({
        server,
        requests,
        url: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

async function androidChord(page, keys) {
  await page.evaluate((downKeys) => {
    for (const key of downKeys) {
      window.handleAndroidKeyEvent(
        "keydown",
        key,
        key === " " ? "Space" : `Key${key.toUpperCase()}`,
        false,
        false,
        false,
        false,
        false,
      );
    }
    for (const key of [...downKeys].reverse()) {
      window.handleAndroidKeyEvent(
        "keyup",
        key,
        key === " " ? "Space" : `Key${key.toUpperCase()}`,
        false,
        false,
        false,
        false,
        false,
      );
    }
  }, keys);
}

async function applyRequestedImeHeight(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const requestedHeight = await page.evaluate(() => window.__androidHeight);
    const viewport = page.viewport();
    if (viewport.height === requestedHeight) return requestedHeight;
    await page.setViewport({ ...viewport, height: requestedHeight });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  }
  return page.evaluate(() => window.__androidHeight);
}

async function main() {
  const { server, requests, url } = await startStaticServer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.__androidPreedits = [];
      window.__androidInferenceBodies = [];
      window.__androidInferenceDelay = 0;
      window.__androidInferenceError = "";
      window.__androidInferenceResponse = null;
      window.__androidModelState = "loading";
      window.__androidPloverBodies = [];
      window.__androidHeight = 0;
      window.__androidKeyboardSwitches = 0;
      window.AndroidIme = {
        getInferenceModelError() {
          return "";
        },
        getInferenceModelState() {
          return window.__androidModelState;
        },
        hasPloverConfiguration() {
          return true;
        },
        isStenoModeEnabled() {
          return true;
        },
        setKeyboardHeight(height) {
          window.__androidHeight = height;
        },
        setPreeditText(text, grammarSectionsJson) {
          window.__androidPreedits.push({
            text,
            grammarSections: JSON.parse(grammarSectionsJson),
          });
        },
        requestInference(body, requestId) {
          window.__androidInferenceBodies.push(JSON.parse(body));
          window.__androidModelState = "loading";
          window.handleAndroidInferenceState("loading");
          setTimeout(() => {
            if (window.__androidInferenceError) {
              window.__androidModelState = "error";
              window.handleAndroidInferenceState("error");
              window.handleAndroidInferenceResponse(
                requestId,
                0,
                "",
                window.__androidInferenceError,
              );
              return;
            }
            window.__androidModelState = "ready";
            window.handleAndroidInferenceState("ready");
            window.handleAndroidInferenceResponse(
              requestId,
              200,
              JSON.stringify(
                window.__androidInferenceResponse || {
                  candidates: [
                    ["alpha beta keep delta omega"],
                    ["alpha x keep delta omega"],
                    ["alpha beta keep y omega"],
                    ["alpha x keep y omega"],
                  ],
                },
              ),
              "",
            );
          }, window.__androidInferenceDelay);
        },
        requestPlover(body, requestId) {
          const request = JSON.parse(body);
          window.__androidPloverBodies.push(request);
          setTimeout(() => {
            const results = {
              get_dictionary_state: {
                solo: false,
                dictionaries: [
                  {
                    identifier: "main.json",
                    enabled: true,
                    readonly: false,
                    entries: 2,
                  },
                ],
              },
              enumerate_entries: {
                page: 1,
                total: 1,
                has_more: false,
                entries: [
                  {
                    dictionary: "main.json",
                    stroke: "TEFT",
                    translation: "test",
                  },
                ],
              },
              search_entries: {
                page: 1,
                total: 1,
                has_more: false,
                entries: [
                  {
                    dictionary: "main.json",
                    stroke: "TEFT",
                    translation: "test",
                  },
                ],
              },
            };
            window.handleAndroidPloverResponse(
              requestId,
              JSON.stringify({
                id: request.id,
                result: results[request.method] || {},
              }),
              "",
            );
          }, 0);
        },
        changeInputMethod() {
          window.__androidKeyboardSwitches += 1;
        },
      };
      if (
        new URL(window.location.href).searchParams.has("dictionary-management")
      ) {
        const imeBridge = window.AndroidIme;
        window.AndroidDictionary = {
          hasPloverConfiguration: () => imeBridge.hasPloverConfiguration(),
          requestPlover: (body, requestId) =>
            imeBridge.requestPlover(body, requestId),
          saveDictionaryFile() {},
          close() {},
        };
        delete window.AndroidIme;
      }
    });
    await page.setViewport({ width: 412, height: 160, deviceScaleFactor: 1 });
    await page.goto(`${url}/ime.html`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.__androidHeight > 0);
    await applyRequestedImeHeight(page);

    const initial = await page.evaluate(() => ({
      stripped: document.body.classList.contains("stripped-display"),
      height: window.__androidHeight,
      text: document.querySelector("#text-display").textContent,
      dedicatedSurface: document.body.classList.contains("ime-surface"),
      inferenceStatus: document.querySelector("#inference-status").textContent,
    }));
    assert(initial.stripped, "Android bridge did not enable stripped mode");
    assert(
      await page.evaluate(
        () => document.querySelector("#plover-dictionary-dialog") === null,
      ),
      "Dictionary editing UI was mounted inside the IME input view",
    );
    assert(
      initial.dedicatedSurface,
      "Android did not load the dedicated IME UI",
    );
    assert(
      initial.height >= 112 && initial.height < 160,
      `Empty IME did not request a compact content height: ${initial.height}`,
    );
    assert(
      initial.text === "👋",
      "Android IME did not start with an empty buffer",
    );
    assert(
      initial.inferenceStatus === "Loading model… · raw buffer",
      `Android IME did not expose initial model readiness: ${JSON.stringify(initial)}`,
    );

    await page.evaluate(() => window.handleAndroidStenoModeChanged(false));
    await page.waitForFunction(
      () =>
        document.body.classList.contains("android-normal-typing") &&
        window.__androidHeight === 48,
    );
    const normalTypingSurface = await page.evaluate(() => ({
      label: document.querySelector(".ime-normal-banner").textContent.trim(),
      banner: getComputedStyle(document.querySelector(".ime-normal-banner"))
        .display,
      ploverBanner: getComputedStyle(
        document.querySelector(".ime-plover-banner"),
      ).display,
      workbench: getComputedStyle(document.querySelector("#workbench")).display,
      height: window.__androidHeight,
    }));
    assert(
      normalTypingSurface.label === "Normal typing" &&
        normalTypingSurface.banner === "flex" &&
        normalTypingSurface.ploverBanner === "none" &&
        normalTypingSurface.workbench === "none" &&
        normalTypingSurface.height === 48,
      `Android normal typing did not use a labeled thin bar: ${JSON.stringify(normalTypingSurface)}`,
    );
    await page.evaluate(() => window.handleAndroidStenoModeChanged(true));
    await page.waitForFunction(
      () =>
        !document.body.classList.contains("android-normal-typing") &&
        window.__androidHeight > 48,
    );
    const preeditsBeforeModifiedKey = await page.evaluate(
      () => window.__androidPreedits.length,
    );

    await page.evaluate(() => {
      window.handleAndroidKeyEvent(
        "keydown",
        "c",
        "KeyC",
        false,
        false,
        true,
        false,
        false,
      );
      window.handleAndroidKeyEvent(
        "keyup",
        "c",
        "KeyC",
        false,
        false,
        true,
        false,
        false,
      );
    });
    const modifiedKeyState = await page.evaluate(() => ({
      inferenceBodies: window.__androidInferenceBodies.length,
      preedits: window.__androidPreedits.length,
      text: document.querySelector("#text-display").textContent,
    }));
    assert(
      modifiedKeyState.inferenceBodies === 0 &&
        modifiedKeyState.preedits === preeditsBeforeModifiedKey &&
        modifiedKeyState.text === "👋",
      `Modified hardware keys leaked into V7 handling: ${JSON.stringify(modifiedKeyState)}`,
    );

    await androidChord(page, ["c", " ", "m"]);
    await page.waitForFunction(
      () =>
        window.__androidInferenceBodies.length === 1 &&
        window.__androidPreedits.at(-1).text === "alpha beta keep delta omega",
    );
    await page.waitForFunction(
      (emptyHeight) => window.__androidHeight > emptyHeight,
      {},
      initial.height,
    );
    await applyRequestedImeHeight(page);

    const bridgeState = await page.evaluate(() => ({
      inferenceBodies: window.__androidInferenceBodies,
      preedit: window.__androidPreedits.at(-1),
      reducedBuffer: document.querySelector("#text-display").textContent,
      candidateCount: document.querySelectorAll("#candidate-area .candidate")
        .length,
      candidatesVisible:
        getComputedStyle(document.querySelector("#candidate-area")).display !==
        "none",
      candidatesOverflow:
        document.querySelector("#candidate-area").scrollHeight >
        document.querySelector("#candidate-area").clientHeight + 1,
      requestedHeight: window.__androidHeight,
      candidateLayout: (() => {
        const area = document.querySelector("#candidate-area");
        const rects = [...area.querySelectorAll(".candidate")].map(
          (candidate) => candidate.getBoundingClientRect(),
        );
        return {
          rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
          usedWidth: rects.reduce((sum, rect) => sum + rect.width, 0),
          availableWidth: area.clientWidth,
        };
      })(),
    }));
    assert(
      bridgeState.inferenceBodies[0].islands.length === 3,
      "Inference request did not use the V7 island protocol",
    );
    assert(
      bridgeState.preedit.text === "alpha beta keep delta omega",
      "Candidate text was not mirrored to Android composing text",
    );
    assert(
      bridgeState.preedit.grammarSections.length === 2,
      "Android composing text did not receive both grammar diff sections",
    );
    assert(
      bridgeState.preedit.grammarSections[0].start === 6 &&
        bridgeState.preedit.grammarSections[0].end === 10 &&
        bridgeState.preedit.grammarSections[0].suggestions.includes("x"),
      "Android left grammar suggestion range was incorrect",
    );
    assert(
      bridgeState.preedit.grammarSections[1].start === 16 &&
        bridgeState.preedit.grammarSections[1].end === 21 &&
        bridgeState.preedit.grammarSections[1].suggestions.includes("y"),
      "Android right grammar suggestion range was incorrect",
    );
    assert(
      bridgeState.reducedBuffer.trim() !== "" &&
        bridgeState.reducedBuffer !== "👋",
      "Reduced composing buffer was not rendered in the IME",
    );
    assert(
      bridgeState.candidatesVisible && bridgeState.candidateCount === 3,
      "Alternative candidates were not rendered in the IME",
    );
    assert(
      bridgeState.candidateLayout.rows === 1 &&
        bridgeState.candidateLayout.usedWidth <
          bridgeState.candidateLayout.availableWidth * 0.75,
      `Candidates were not packed to their content widths: ${JSON.stringify(bridgeState)}`,
    );
    assert(
      !bridgeState.candidatesOverflow &&
        bridgeState.requestedHeight > initial.height,
      `IME did not expand to fit alternatives before enabling scrolling: ${JSON.stringify(bridgeState)}`,
    );

    await page.evaluate(() => window.clearPreeditFromAndroid());
    await page.waitForFunction(
      (emptyHeight) => window.__androidHeight === emptyHeight,
      {},
      initial.height,
    );
    await applyRequestedImeHeight(page);
    const cleared = await page.evaluate(() => ({
      preedit: window.__androidPreedits.at(-1),
      preeditCount: window.__androidPreedits.length,
      text: document.querySelector("#text-display").textContent,
    }));
    assert(
      cleared.preedit.text === "" &&
        cleared.preedit.grammarSections.length === 0,
      "Android reset did not clear composing text",
    );
    assert(
      cleared.text === "👋",
      "Android reset did not clear the WebUI buffer",
    );

    await page.evaluate(() => {
      window.AndroidIme.requestInferenceSync = (body) => {
        window.__androidInferenceBodies.push(JSON.parse(body));
        if (window.__androidInferenceError) {
          window.__androidModelState = "error";
          window.handleAndroidInferenceState("error");
          return JSON.stringify({
            statusCode: 0,
            responseBody: "",
            errorMessage: window.__androidInferenceError,
          });
        }
        window.__androidModelState = "ready";
        window.handleAndroidInferenceState("ready");
        return JSON.stringify({
          statusCode: 200,
          responseBody: JSON.stringify(
            window.__androidInferenceResponse || {
              candidates: [
                ["alpha beta keep delta omega"],
                ["alpha x keep delta omega"],
                ["alpha beta keep y omega"],
                ["alpha x keep y omega"],
              ],
            },
          ),
          errorMessage: "",
        });
      };
      window.__androidInferenceDelay = 200;
      window.__androidInferenceResponse = {
        candidates: [["ready pending result"]],
      };
    });
    await androidChord(page, ["c", " ", "m"]);
    const readyPendingInference = await page.evaluate(() => ({
      reducedBuffer: document.querySelector("#text-display").textContent,
      preedit: window.__androidPreedits.at(-1).text,
      preedits: window.__androidPreedits.length,
      inferenceBodies: window.__androidInferenceBodies.length,
    }));
    assert(
      readyPendingInference.preedit === "ready pending result" &&
        !readyPendingInference.reducedBuffer.includes("[") &&
        readyPendingInference.preedits > cleared.preeditCount &&
        readyPendingInference.inferenceBodies === 2,
      `Android did not render synchronous inference without raw V7 flicker: ${JSON.stringify(readyPendingInference)}`,
    );
    await page.evaluate(() => {
      delete window.AndroidIme.requestInferenceSync;
      window.__androidInferenceResponse = null;
      window.clearPreeditFromAndroid();
    });

    await page.evaluate(() => {
      window.__androidModelState = "loading";
      window.handleAndroidInferenceState("loading");
      window.__androidInferenceDelay = 200;
      window.__androidInferenceError =
        "Unable to memory-map the selected lm.binary file";
    });
    await androidChord(page, ["c", " ", "m"]);
    const pendingInference = await page.evaluate(() => ({
      reducedBuffer: document.querySelector("#text-display").textContent,
      preedit: window.__androidPreedits.at(-1).text,
      candidatesHidden:
        getComputedStyle(document.querySelector("#candidate-area")).display ===
        "none",
      inferenceStatus: document.querySelector("#inference-status").textContent,
    }));
    assert(
      pendingInference.reducedBuffer.trim() !== "" &&
        pendingInference.preedit.trim() !== "" &&
        pendingInference.candidatesHidden &&
        pendingInference.inferenceStatus === "Loading model… · raw buffer",
      `Edited buffer was not rendered while inference was pending: ${JSON.stringify(pendingInference)}`,
    );
    await page.waitForFunction(
      () =>
        !document.querySelector("#inference-error").hidden &&
        document
          .querySelector("#inference-error")
          .textContent.includes("Unable to memory-map"),
    );
    const failedInference = await page.evaluate(() => ({
      error: document.querySelector("#inference-error").textContent,
      reducedBuffer: document.querySelector("#text-display").textContent,
      preedit: window.__androidPreedits.at(-1).text,
      inferenceStatus: document.querySelector("#inference-status").textContent,
    }));
    assert(
      failedInference.error.startsWith("Inference error:") &&
        failedInference.reducedBuffer.trim() !== "" &&
        failedInference.preedit.trim() !== "" &&
        failedInference.inferenceStatus === "Model error",
      `Inference failure was not visible while preserving the buffer: ${JSON.stringify(failedInference)}`,
    );

    await page.evaluate(() => {
      window.__androidInferenceDelay = 0;
      window.__androidInferenceError = "";
      window.clearPreeditFromAndroid();
      window.__androidInferenceResponse = {
        candidates: [
          ["current"],
          ["one"],
          ["two"],
          [
            "an-extraordinarily-long-candidate-that-must-wrap-inside-its-own-box",
          ],
          ["three"],
        ],
      };
    });
    await androidChord(page, ["c", " ", "m"]);
    await page.waitForFunction(
      () =>
        document.querySelectorAll("#candidate-area .candidate").length === 4,
    );
    await applyRequestedImeHeight(page);
    const packedCandidates = await page.evaluate(() => {
      const area = document.querySelector("#candidate-area");
      const candidates = [...area.querySelectorAll(".candidate")];
      const rects = candidates.map((candidate) =>
        candidate.getBoundingClientRect(),
      );
      return {
        areaWidth: area.getBoundingClientRect().width,
        sameFirstRow: Math.abs(rects[0].top - rects[1].top) < 1,
        longCandidateMoved: rects[2].top > rects[1].top + rects[1].height - 1,
        longCandidateFits: rects[2].width <= area.clientWidth + 1,
        longCandidateWrapped: rects[2].height > rects[0].height + 1,
        candidatesOverflow: area.scrollHeight > area.clientHeight + 1,
        inferenceStatus:
          document.querySelector("#inference-status").textContent,
      };
    });
    assert(
      packedCandidates.sameFirstRow &&
        packedCandidates.longCandidateMoved &&
        packedCandidates.longCandidateFits &&
        packedCandidates.longCandidateWrapped &&
        !packedCandidates.candidatesOverflow &&
        packedCandidates.inferenceStatus === "Model ready",
      `Candidates did not wrap whole items before splitting an oversized item: ${JSON.stringify(packedCandidates)}`,
    );

    await page.evaluate(() => {
      window.__androidInferenceResponse = null;
      window.clearPreeditFromAndroid();
    });
    await applyRequestedImeHeight(page);
    assert(
      !(await page.$("#keyboard-layout")) &&
        !(await page.$("#ime-layout-toggle")) &&
        !(await page.$("#qwerty-board")),
      "Dedicated IME UI must not render a physical keyboard layout",
    );

    const phrase = [
      ["w", "c"],
      ["e", "r", "c", "o"],
      ["s", "c"],
      ["r", "f", "c", "l"],
      ["e", "d", "c"],
      ["w", "e", "r", "v", "o"],
    ];
    await page.setViewport({ ...page.viewport(), width: 280 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const narrowEmptyHeight = await applyRequestedImeHeight(page);
    for (let syllable = 0; syllable < 9; syllable += 1) {
      await androidChord(page, ["s", "c", "v"]);
      await page.keyboard.type("123");
    }
    await page.waitForFunction(
      (emptyHeight) => window.__androidHeight > emptyHeight,
      {},
      narrowEmptyHeight,
    );
    const longBuffer = await page.evaluate(() => ({
      syllableCount: document.querySelectorAll(".piecemeal-syllable").length,
      candidatesHidden:
        getComputedStyle(document.querySelector("#candidate-area")).display ===
        "none",
      requestedHeight: window.__androidHeight,
    }));
    assert(
      longBuffer.syllableCount === 9 && longBuffer.candidatesHidden,
      `Long buffer did not independently expand the IME: ${JSON.stringify(longBuffer)}`,
    );

    await page.evaluate(() => window.clearPreeditFromAndroid());
    await page.setViewport({ ...page.viewport(), width: 412 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await applyRequestedImeHeight(page);

    for (const keys of phrase) {
      await androidChord(page, keys);
    }
    await page.waitForFunction(
      () => document.querySelectorAll(".piecemeal-syllable").length === 6,
    );
    const piecemealBefore = await page.$$eval(".piecemeal-token", (tokens) =>
      tokens.map((token) => token.getBoundingClientRect().left),
    );
    await androidChord(page, ["w", "s"]); // TK selects a middle target.
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".piecemeal-syllable.active").length === 1,
    );
    const piecemealAfter = await page.evaluate(() => {
      const syllables = [...document.querySelectorAll(".piecemeal-syllable")];
      const flow = document.querySelector(".text-display-flow");
      return {
        activeIndex: syllables.findIndex((node) =>
          node.classList.contains("active"),
        ),
        positions: [...document.querySelectorAll(".piecemeal-token")].map(
          (token) => token.getBoundingClientRect().left,
        ),
        interSyllableSpaces: [...flow.childNodes].filter(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent === " ",
        ).length,
      };
    });
    assert(
      piecemealAfter.activeIndex === 2,
      `Piecemeal test did not activate a middle syllable: ${JSON.stringify(piecemealAfter)}`,
    );
    assert(
      piecemealAfter.interSyllableSpaces === 5,
      `Piecemeal rendering lost natural inter-syllable spaces: ${JSON.stringify(piecemealAfter)}`,
    );
    assert(
      piecemealAfter.positions.every(
        (left, index) => Math.abs(left - piecemealBefore[index]) < 0.1,
      ),
      `Middle piecemeal highlighting changed syllable spacing: ${JSON.stringify(
        {
          before: piecemealBefore,
          after: piecemealAfter.positions,
        },
      )}`,
    );

    await androidChord(page, ["q", "a"]);
    assert(
      await page.evaluate(() => window.__androidKeyboardSwitches === 1),
      "Q+A did not invoke the Android input method picker",
    );

    await page.click("#ime-switch-keyboard");
    assert(
      await page.evaluate(() => window.__androidKeyboardSwitches === 2),
      "IME keyboard button did not invoke the Android input method picker",
    );

    await page.waitForFunction(
      () =>
        document.querySelector("#plover-status").textContent === "Available",
    );
    await androidChord(page, ["q"]); // # toggles Stripped Plover.
    await page.waitForFunction(
      () =>
        document.body.classList.contains("stripped-plover-active") &&
        window.__androidHeight === 48,
    );
    const ploverSurface = await page.evaluate(() => ({
      label: document.querySelector(".ime-plover-banner").textContent.trim(),
      banner: getComputedStyle(document.querySelector(".ime-plover-banner"))
        .display,
      workbench: getComputedStyle(document.querySelector("#workbench")).display,
      height: window.__androidHeight,
    }));
    assert(
      ploverSurface.label === "Stripped Plover" &&
        ploverSurface.banner === "flex" &&
        ploverSurface.workbench === "none" &&
        ploverSurface.height === 48,
      `Active Plover surface was not reduced to a thin status bar: ${JSON.stringify(ploverSurface)}`,
    );
    assert(
      !requests.some((request) => request.startsWith("/infer")),
      "Android inference bypassed the native bridge",
    );
    assert(
      !requests.some((request) => request.startsWith("/plover")),
      "Android Stripped Plover traffic bypassed the native bridge",
    );
    assert(
      await page.evaluate(() => window.__androidPloverBodies.length > 0),
      "Android mode did not use the native Stripped Plover bridge",
    );

    await page.goto(`${url}/dictionary.html?dictionary-management=1`, {
      waitUntil: "networkidle0",
    });
    await page.waitForFunction(
      () =>
        document.querySelector("#plover-dictionary-dialog")?.open &&
        document.querySelector(".plover-dictionary-name")?.textContent ===
          "main.json",
    );
    const managementSurface = await page.evaluate(() => ({
      managementPage: document.body.classList.contains(
        "dictionary-management-page",
      ),
      hasInferenceSurface: document.querySelector("#inference-shell") !== null,
      hasImeBridge: "AndroidIme" in window,
      hasDictionaryBridge: "AndroidDictionary" in window,
      tabs: document.querySelectorAll(".plover-tab").length,
      dictionary: document.querySelector(".plover-dictionary-name").textContent,
    }));
    assert(
      managementSurface.managementPage &&
        !managementSurface.hasInferenceSurface &&
        !managementSurface.hasImeBridge &&
        managementSurface.hasDictionaryBridge &&
        managementSurface.tabs === 3 &&
        managementSurface.dictionary === "main.json",
      `Android settings did not host the shared dictionary UI: ${JSON.stringify(managementSurface)}`,
    );

    const dictionaryScroll = await page.evaluate(async () => {
      const dialog = document.querySelector("#plover-dictionary-dialog");
      const content = document.querySelector(".plover-dialog-content");
      if (!dialog || !content) return null;
      const before = content.scrollTop;
      content.scrollTop = content.scrollHeight;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const result = {
        before,
        after: content.scrollTop,
        clientHeight: content.clientHeight,
        scrollHeight: content.scrollHeight,
        dialogOverflow: getComputedStyle(dialog).overflow,
        contentOverflowY: getComputedStyle(content).overflowY,
        dictionaryListOverflow: getComputedStyle(
          document.querySelector("#plover-dictionary-list"),
        ).overflowY,
      };
      content.scrollTop = 0;
      return result;
    });
    assert(
      dictionaryScroll &&
        dictionaryScroll.scrollHeight > dictionaryScroll.clientHeight &&
        dictionaryScroll.after > dictionaryScroll.before &&
        dictionaryScroll.dialogOverflow === "hidden" &&
        dictionaryScroll.contentOverflowY === "auto" &&
        dictionaryScroll.dictionaryListOverflow === "visible",
      `Android dictionary surface did not expose one working page scroller: ${JSON.stringify(dictionaryScroll)}`,
    );

    await page.click("#plover-tab-entries");
    await page.waitForFunction(
      () =>
        document.querySelector(".plover-entry-result span")?.textContent ===
        "TEFT",
    );
    await page.select("#plover-entry-dict", "main.json");
    await page.type("#plover-entry-stroke", "T*");
    await page.type("#plover-entry-translation", "entry");
    await page.click("#plover-entry-add");
    await page.waitForFunction(() =>
      window.__androidPloverBodies.some(
        (request) =>
          request.method === "add_entry" &&
          request.params.name === "main.json" &&
          request.params.stroke === "T*" &&
          request.params.translation === "entry",
      ),
    );
    console.log("Android IME WebUI bridge interactions passed");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
