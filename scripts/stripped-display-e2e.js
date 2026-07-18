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

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/plover/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ available: true }));
      return;
    }
    if (url.pathname === "/infer") {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            candidates: [["một giữa hai"], ["ba giữa bốn"], ["năm giữa sáu"]],
          }),
        );
      });
      return;
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.normalize(path.join(STATIC_DIR, requested));
    if (!file.startsWith(`${STATIC_DIR}${path.sep}`)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (error, data) => {
      if (error) return res.writeHead(404).end();
      const type =
        path.extname(file) === ".js" ? "text/javascript" : "text/html";
      res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function chord(page, keys) {
  for (const key of keys) await page.keyboard.down(key);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

async function newPage(browser, url, viewport = { width: 412, height: 300 }) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text) => (window.__copiedText = text) },
    });
    class FakeWebSocket {
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      listeners = new Map();
      constructor() {
        setTimeout(() => this.emit("open", {}), 0);
      }
      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }
      emit(type, event) {
        for (const listener of this.listeners.get(type) || []) listener(event);
      }
      send(payload) {
        const request = JSON.parse(payload);
        setTimeout(
          () =>
            this.emit("message", {
              data: JSON.stringify({
                id: request.id,
                ok: true,
                result: { dictionaries: [], solo: false },
              }),
            }),
          0,
        );
      }
      close() {}
    }
    window.WebSocket = FakeWebSocket;
  });
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0" });
  return page;
}

async function testEmptyAndBufferInteractions(browser, url) {
  const page = await newPage(browser, url);
  await page.evaluate(() => window.setStrippedDisplay({ copyAllowed: true }));
  let view = await page.evaluate(() => ({
    text: document.querySelector("#text-display").textContent,
    candidates: getComputedStyle(document.querySelector("#candidate-area"))
      .display,
    plover: getComputedStyle(document.querySelector("#plover-controls"))
      .display,
  }));
  assert(
    view.text === "👋",
    `Expected empty wave, got ${JSON.stringify(view)}`,
  );
  assert(view.candidates === "none", "Empty candidate panel is visible");
  assert(view.plover === "none", "Plover controls are visible");
  const emptyMetrics = await page.$eval("#text-display", (node) => {
    const style = getComputedStyle(node);
    const wave = node.querySelector(".empty-wave");
    return {
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      paddingLeft: parseFloat(style.paddingLeft),
      waveSize: parseFloat(getComputedStyle(wave).fontSize),
    };
  });
  assert(
    emptyMetrics.fontSize >= 20 && emptyMetrics.fontSize <= 24,
    `Stripped text is outside the 20–24px IME scale: ${JSON.stringify(emptyMetrics)}`,
  );
  assert(
    emptyMetrics.lineHeight / emptyMetrics.fontSize >= 1.25 &&
      emptyMetrics.lineHeight / emptyMetrics.fontSize <= 1.35,
    `Stripped line height is not compact: ${JSON.stringify(emptyMetrics)}`,
  );
  assert(
    emptyMetrics.paddingLeft === 16,
    `Stripped display is not on the 8px spacing grid: ${JSON.stringify(emptyMetrics)}`,
  );
  assert(
    emptyMetrics.waveSize <= 80,
    `Empty state overwhelms an IME viewport: ${JSON.stringify(emptyMetrics)}`,
  );

  // KAO produces a fixed Vietnamese syllable. Surround a four-character
  // capital run with enough syllables to exercise both truncation and ellipsis.
  for (let i = 0; i < 5; i++) await chord(page, ["s", "c", "v"]);
  for (const digit of "1234") await page.keyboard.press(digit);
  for (let i = 0; i < 6; i++) await chord(page, ["s", "c", "v"]);
  await page.waitForFunction(
    () => document.querySelectorAll(".piecemeal-syllable").length === 9,
  );

  view = await page.evaluate(() => ({
    markers: [...document.querySelectorAll(".piecemeal-syllable")].map(
      (node) => node.textContent,
    ),
    numbers: [...document.querySelectorAll(".piecemeal-number")].map(
      (node) => node.textContent,
    ),
    text: document.querySelector("#text-display").textContent,
  }));
  assert(view.markers.length === 9, "Did not retain exactly nine syllables");
  assert(view.numbers.join(",") === "9,8,7,6,5,4,3,2,1", "Numbering changed");
  assert(
    view.text.includes("…"),
    `Long non-Vietnamese run was not abbreviated: ${JSON.stringify(view)}`,
  );
  const renderedBuffer = await page.$eval("#text-display", (display) => {
    const flow = display.querySelector(".text-display-flow");
    const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    let text = "";
    while (walker.nextNode()) text += walker.currentNode.textContent;
    const interTokenSpace = [...flow.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent === " ",
    );
    const range = document.createRange();
    if (interTokenSpace) range.selectNodeContents(interTokenSpace);
    return {
      directChildren: display.children.length,
      flowText: text,
      flowWhiteSpace: getComputedStyle(flow).whiteSpace,
      fontSize: parseFloat(getComputedStyle(flow).fontSize),
      interTokenSpaceWidth: interTokenSpace
        ? range.getBoundingClientRect().width
        : 0,
    };
  });
  assert(
    renderedBuffer.directChildren === 1 &&
      renderedBuffer.flowWhiteSpace === "pre-wrap",
    `Buffer fragments escaped the normal text flow: ${JSON.stringify(renderedBuffer)}`,
  );
  assert(
    renderedBuffer.interTokenSpaceWidth / renderedBuffer.fontSize >= 0.15 &&
      renderedBuffer.interTokenSpaceWidth / renderedBuffer.fontSize <= 0.5,
    `Rendered whitespace no longer matches the text buffer: ${JSON.stringify(renderedBuffer)}`,
  );

  await page.keyboard.down("Control");
  await page.keyboard.press("c");
  await page.keyboard.up("Control");
  const copied = await page.evaluate(() => window.__copiedText);
  assert(
    (copied.match(/câ/g) || []).length === 11,
    "Copy omitted hidden syllables",
  );
  assert(copied.includes("1234"), "Copy omitted hidden non-Vietnamese text");

  await chord(page, ["q", "a"]); // #S- raw-text escape hatch
  const rawDisplay = await page.$eval(
    "#text-input",
    (node) => getComputedStyle(node).display,
  );
  assert(rawDisplay === "none", "Raw-text escape hatch remained active");
  await page.screenshot({ path: "/tmp/stripped-display.png" });
  await page.close();
}

async function testCandidates(browser, url) {
  const page = await newPage(browser, url);
  const logs = [];
  page.on("console", (message) => logs.push(message.text()));
  await page.evaluate(() => window.setStrippedDisplay({ copyAllowed: false }));
  await chord(page, ["c", " ", "m"]); // Valid two-syllable V7 island.
  await page.waitForFunction(
    () => document.querySelectorAll("#candidate-area .candidate").length === 2,
  );
  const candidateNumbers = await page.$$eval(
    "#candidate-area .candidate sup",
    (nodes) => nodes.map((node) => node.textContent),
  );
  assert(candidateNumbers.join(",") === "2,3", "Candidate 1 was not omitted");
  assert(
    await page.$("#candidate-area .candidate-section-left"),
    "Left candidate diff region was lost",
  );
  assert(
    await page.$("#candidate-area .candidate-section-right"),
    "Right candidate diff region was lost",
  );
  assert(
    logs.some((line) => line.includes("Candidate diff regions:")),
    "Diff ranges not logged",
  );
  const candidateMetrics = await page.$eval(
    "#candidate-area .candidate",
    (node) => {
      const areaStyle = getComputedStyle(node.parentElement);
      const style = getComputedStyle(node);
      return {
        areaGap: parseFloat(areaStyle.gap),
        areaPaddingLeft: parseFloat(areaStyle.paddingLeft),
        bufferFontSize: parseFloat(
          getComputedStyle(document.querySelector("#text-display")).fontSize,
        ),
        fontSize: parseFloat(
          getComputedStyle(node.querySelector(".candidate-text")).fontSize,
        ),
        height: node.getBoundingClientRect().height,
        paddingLeft: parseFloat(style.paddingLeft),
      };
    },
  );
  assert(
    candidateMetrics.height >= 48,
    `Candidate touch target is shorter than 48px: ${JSON.stringify(candidateMetrics)}`,
  );
  assert(
    candidateMetrics.fontSize === 16 &&
      candidateMetrics.bufferFontSize === 20 &&
      candidateMetrics.fontSize / candidateMetrics.bufferFontSize === 0.8 &&
      candidateMetrics.areaGap === 8 &&
      candidateMetrics.areaPaddingLeft === 12 &&
      candidateMetrics.paddingLeft === 12,
    `Candidate type or spacing left the IME scale: ${JSON.stringify(candidateMetrics)}`,
  );
  await page.screenshot({ path: "/tmp/stripped-candidates.png" });
  await page.click("#candidate-area .candidate");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#candidate-area")).display ===
      "none",
  );
  assert(
    (await page.$eval("#text-display", (node) => node.textContent)).includes(
      "ba",
    ),
    "Visible candidate 2 did not select underlying candidate index 2",
  );

  await page.keyboard.down("Control");
  await page.keyboard.press("c");
  await page.keyboard.up("Control");
  assert(
    (await page.evaluate(() => window.__copiedText)) === undefined,
    "copyAllowed: false still copied the buffer",
  );
  await page.close();
}

async function testNaturalPiecemealLayout(browser, url) {
  const page = await newPage(browser, url);
  await page.evaluate(() => window.setStrippedDisplay({ copyAllowed: false }));

  const phrase = [
    { keys: ["w", "c"], text: "ta" },
    { keys: ["e", "r", "c", "o"], text: "má" },
    { keys: ["s", "c"], text: "ca" },
    { keys: ["r", "f", "c", "l"], text: "là" },
    { keys: ["e", "d", "c"], text: "ba" },
    { keys: ["w", "e", "r", "v", "o"], text: "nó" },
  ];
  for (const word of phrase) await chord(page, word.keys);
  await page.waitForFunction(
    () => document.querySelectorAll(".piecemeal-syllable").length === 6,
  );

  const layout = await page.evaluate(() => {
    const flow = document.querySelector(".text-display-flow");
    const words = [...document.querySelectorAll(".piecemeal-token")];
    return {
      text: flow.textContent,
      words: words.map((word) => {
        const rect = word.getBoundingClientRect();
        const syllable = word.querySelector(".piecemeal-syllable");
        const number = word.querySelector(".piecemeal-number");
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          syllableRight: syllable.getBoundingClientRect().right,
          numberLeft: number?.getBoundingClientRect().left ?? null,
          numberPosition: number ? getComputedStyle(number).position : null,
          numberWidth: number?.getBoundingClientRect().width ?? null,
        };
      }),
    };
  });
  assert(
    phrase.every((word) => layout.text.includes(word.text)),
    `Natural phrase did not render as entered: ${JSON.stringify(layout)}`,
  );
  assert(
    layout.words
      .filter((word) => word.numberLeft !== null)
      .every(
        (word) =>
          word.numberPosition === "absolute" &&
          word.numberLeft >= word.syllableRight - 0.1 &&
          Math.abs(word.right - word.syllableRight) < 0.1,
      ),
    `Piecemeal labels alter buffer spacing or moved before a syllable: ${JSON.stringify(layout)}`,
  );
  const numberWidths = layout.words
    .map((word) => word.numberWidth)
    .filter((width) => width !== null);
  assert(
    Math.max(...numberWidths) - Math.min(...numberWidths) < 0.1,
    `Piecemeal superscripts do not share one width: ${JSON.stringify(numberWidths)}`,
  );
  await page.screenshot({ path: "/tmp/stripped-words.png" });

  await chord(page, ["w"]); // T selects the first piecemeal target.
  await page.waitForFunction(
    () => document.querySelectorAll(".piecemeal-syllable.active").length === 1,
  );
  const activeWordPositions = await page.$$eval(".piecemeal-token", (words) =>
    words.map((word) => word.getBoundingClientRect().left),
  );
  assert(
    activeWordPositions.every(
      (left, index) => Math.abs(left - layout.words[index].left) < 0.1,
    ),
    `Entering piecemeal mode shifted the buffer: ${JSON.stringify({
      before: layout.words.map((word) => word.left),
      active: activeWordPositions,
    })}`,
  );
  await page.screenshot({ path: "/tmp/stripped-piecemeal-active.png" });
  await page.close();
}

async function testPloverBlanking(browser, url) {
  const page = await newPage(browser, url);
  await page.waitForFunction(
    () => document.querySelector("#plover-status").textContent === "Available",
  );
  await page.evaluate(() => window.setStrippedDisplay({ copyAllowed: false }));
  await chord(page, ["q"]);
  await page.waitForFunction(() =>
    document.body.classList.contains("stripped-plover-active"),
  );
  const result = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    visibility: getComputedStyle(document.querySelector("#inference-shell"))
      .visibility,
  }));
  assert(
    result.background === "rgb(255, 235, 59)",
    `Plover background is not yellow: ${JSON.stringify(result)}`,
  );
  assert(result.visibility === "hidden", "Plover mode did not blank the UI");
  await page.close();
}

(async () => {
  const { server, url } = await startServer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    await testEmptyAndBufferInteractions(browser, url);
    await testCandidates(browser, url);
    await testNaturalPiecemealLayout(browser, url);
    await testPloverBlanking(browser, url);
    console.log("Stripped display interactions passed");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
