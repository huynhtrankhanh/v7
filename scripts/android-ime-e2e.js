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
        setPreeditText(text) {
          window.__androidPreedits.push(text);
        },
        requestInference(body, requestId) {
          window.__androidInferenceBodies.push(JSON.parse(body));
          setTimeout(() => {
            window.handleAndroidInferenceResponse(
              requestId,
              200,
              JSON.stringify({
                candidates: [["xin chào"], ["chào bạn"]],
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
        window.__androidPreedits.at(-1) === "xin chào",
    );

    const bridgeState = await page.evaluate(() => ({
      inferenceBodies: window.__androidInferenceBodies,
      preedit: window.__androidPreedits.at(-1),
      visible: document.querySelector("#text-display").textContent,
    }));
    assert(
      bridgeState.inferenceBodies[0].islands.length === 3,
      "Inference request did not use the V7 island protocol",
    );
    assert(
      bridgeState.preedit === "xin chào",
      "Candidate text was not mirrored to Android composing text",
    );
    assert(
      bridgeState.visible.includes("xin") &&
        bridgeState.visible.includes("chào"),
      "Inference candidate was not rendered in the stripped WebUI",
    );

    await page.evaluate(() => window.clearPreeditFromAndroid());
    const cleared = await page.evaluate(() => ({
      preedit: window.__androidPreedits.at(-1),
      text: document.querySelector("#text-display").textContent,
    }));
    assert(
      cleared.preedit === "",
      "Android reset did not clear composing text",
    );
    assert(
      cleared.text === "👋",
      "Android reset did not clear the WebUI buffer",
    );
    await page.click("#ime-layout-toggle");
    assert(
      await page.$eval("#keyboard-layout", (layout) =>
        layout.classList.contains("visible"),
      ),
      "IME layout button did not open the physical keyboard visualization",
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
