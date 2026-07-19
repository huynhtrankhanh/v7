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
      window.__androidPloverBodies = [];
      window.__androidHeight = 0;
      window.__androidKeyboardSwitches = 0;
      window.AndroidIme = {
        hasPloverConfiguration() {
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
          setTimeout(() => {
            window.handleAndroidInferenceResponse(
              requestId,
              200,
              JSON.stringify({
                candidates: [
                  ["alpha beta keep delta omega"],
                  ["alpha x keep delta omega"],
                  ["alpha beta keep y omega"],
                  ["alpha x keep y omega"],
                ],
              }),
              "",
            );
          }, 0);
        },
        requestPlover(body, requestId) {
          const request = JSON.parse(body);
          window.__androidPloverBodies.push(request);
          setTimeout(() => {
            window.handleAndroidPloverResponse(
              requestId,
              JSON.stringify({
                id: request.id,
                result:
                  request.method === "list_dictionaries"
                    ? { dictionaries: [] }
                    : {},
              }),
              "",
            );
          }, 0);
        },
        changeInputMethod() {
          window.__androidKeyboardSwitches += 1;
        },
      };
    });
    await page.setViewport({ width: 412, height: 300, deviceScaleFactor: 1 });
    await page.goto(`${url}/ime.html`, { waitUntil: "networkidle0" });

    const initial = await page.evaluate(() => ({
      stripped: document.body.classList.contains("stripped-display"),
      height: window.__androidHeight,
      text: document.querySelector("#text-display").textContent,
      dedicatedSurface: document.body.classList.contains("ime-surface"),
    }));
    assert(initial.stripped, "Android bridge did not enable stripped mode");
    assert(
      initial.dedicatedSurface,
      "Android did not load the dedicated IME UI",
    );
    assert(initial.height === 300, "Android keyboard height was not requested");
    assert(
      initial.text === "👋",
      "Android IME did not start with an empty buffer",
    );

    await androidChord(page, ["c", " ", "m"]);
    await page.waitForFunction(
      () =>
        window.__androidInferenceBodies.length === 1 &&
        window.__androidPreedits.at(-1).text === "alpha beta keep delta omega",
    );
    await page.waitForFunction(() => window.__androidHeight > 300);

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
      !bridgeState.candidatesOverflow && bridgeState.requestedHeight > 300,
      `IME did not expand to fit alternatives before enabling scrolling: ${JSON.stringify(bridgeState)}`,
    );

    await page.evaluate(() => window.clearPreeditFromAndroid());
    const cleared = await page.evaluate(() => ({
      preedit: window.__androidPreedits.at(-1),
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
    assert(
      !(await page.$("#keyboard-layout")) &&
        !(await page.$("#ime-layout-toggle")) &&
        !(await page.$("#qwerty-board")),
      "Dedicated IME UI must not render a physical keyboard layout",
    );
    await page.click("#ime-switch-keyboard");
    assert(
      await page.evaluate(() => window.__androidKeyboardSwitches === 1),
      "IME keyboard button did not invoke the Android input method picker",
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
