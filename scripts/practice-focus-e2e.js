#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const STATIC_DIR = path.join(ROOT, "static");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.normalize(path.join(STATIC_DIR, pathname));

    if (!filePath.startsWith(`${STATIC_DIR}${path.sep}`)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not determine static server port"));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function newPracticePage(browser, baseUrl) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Math.random = () => 0;
  });
  await page.goto(`${baseUrl}/practice.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.practiceGame && document.querySelector("#mode-select")?.options.length > 0);
  await page.select("#mode-select", "emily");
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#emily-help-btn")).display !== "none");
  return page;
}

async function score(page) {
  return page.$eval("#score", (el) => el.textContent || "");
}

async function activeId(page) {
  return page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || "");
}

async function assertScore(page, expected, label) {
  const actual = await score(page);
  if (actual !== String(expected)) {
    throw new Error(`${label}: expected score ${expected}, got ${actual}`);
  }
}

async function sendEmilyChord(page) {
  for (const key of ["d", "r", "u", "j"]) {
    await page.keyboard.down(key);
  }
  for (const key of ["j", "u", "r", "d"]) {
    await page.keyboard.up(key);
  }
}

async function scenarioStartFromFocusedSelect(browser, baseUrl) {
  const page = await newPracticePage(browser, baseUrl);
  try {
    await page.focus("#mode-select");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("#start-btn").disabled === true);

    const focused = await activeId(page);
    if (focused !== "practice-area") {
      throw new Error(`Expected practice area focus after keyboard start, got ${focused}`);
    }

    await sendEmilyChord(page);
    await assertScore(page, 1, "focused select keyboard start");
  } finally {
    await page.close();
  }
}

async function scenarioSpaceStartsFocusedButton(browser, baseUrl) {
  const page = await newPracticePage(browser, baseUrl);
  try {
    await page.focus("#start-btn");
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.querySelector("#start-btn").disabled === true);
    await sendEmilyChord(page);
    await assertScore(page, 1, "focused start button Space activation");
  } finally {
    await page.close();
  }
}

async function scenarioFocusedButtonDuringRound(browser, baseUrl) {
  const page = await newPracticePage(browser, baseUrl);
  try {
    await page.click("#start-btn");
    await page.waitForFunction(() => document.querySelector("#start-btn").disabled === true);
    await page.focus("#emily-help-btn");
    await sendEmilyChord(page);
    await assertScore(page, 1, "focused help button during round");
  } finally {
    await page.close();
  }
}

async function scenarioDialogBlocksThenResumes(browser, baseUrl) {
  const page = await newPracticePage(browser, baseUrl);
  try {
    await page.click("#start-btn");
    await page.click("#emily-help-btn");
    await page.waitForSelector("#emily-help-backdrop.open");

    await sendEmilyChord(page);
    await assertScore(page, 0, "dialog should block gameplay keys");

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#emily-help-backdrop").classList.contains("open"));

    const focused = await activeId(page);
    if (focused !== "practice-area") {
      throw new Error(`Expected practice area focus after closing dialog during round, got ${focused}`);
    }

    await sendEmilyChord(page);
    await assertScore(page, 1, "dialog close should resume gameplay capture");
  } finally {
    await page.close();
  }
}

async function scenarioBlurClearsStaleHeldKeys(browser, baseUrl) {
  const page = await newPracticePage(browser, baseUrl);
  try {
    await page.click("#start-btn");
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true, cancelable: true }));
      window.dispatchEvent(new Event("blur"));
    });

    await sendEmilyChord(page);
    await assertScore(page, 1, "window blur should clear stale held keys");
  } finally {
    await page.close();
  }
}

async function main() {
  const { server, baseUrl } = await startStaticServer();
  let browser;
  const scenarios = [
    scenarioStartFromFocusedSelect,
    scenarioSpaceStartsFocusedButton,
    scenarioFocusedButtonDuringRound,
    scenarioDialogBlocksThenResumes,
    scenarioBlurClearsStaleHeldKeys,
  ];

  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    for (const scenario of scenarios) {
      await scenario(browser, baseUrl);
    }
    console.log(`Practice focus stress scenarios passed: ${scenarios.length}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
