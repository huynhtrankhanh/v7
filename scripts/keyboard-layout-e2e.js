#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const STATIC_DIR = path.join(ROOT, "static");
const SCREENSHOT_DIR = path.join(os.tmpdir(), "v7-keyboard-layout");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = decodeURIComponent(
      url.pathname === "/" ? "/index.html" : url.pathname,
    );
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
        "Content-Type":
          CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
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

async function toggleKeyboard(page) {
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await page.waitForSelector("#keyboard-layout.visible");
}

async function assertLegible(page, label) {
  const metrics = await page.evaluate(() => {
    const keys = Array.from(document.querySelectorAll(".qwerty-key")).map(
      (el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          text: el.textContent || "",
          width: rect.width,
          height: rect.height,
          fontSize: parseFloat(style.fontSize),
          clipped:
            el.scrollWidth > el.clientWidth + 1 ||
            el.scrollHeight > el.clientHeight + 1,
        };
      },
    );
    const root = document.scrollingElement || document.documentElement;
    return {
      minWidth: Math.min(...keys.map((key) => key.width)),
      minHeight: Math.min(...keys.map((key) => key.height)),
      minFontSize: Math.min(...keys.map((key) => key.fontSize)),
      clipped: keys.filter((key) => key.clipped),
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
    };
  });

  if (
    metrics.minWidth < 20 ||
    metrics.minHeight < 28 ||
    metrics.minFontSize < 11
  ) {
    throw new Error(
      `${label} keyboard keys are too small: ${JSON.stringify(metrics)}`,
    );
  }
  if (metrics.clipped.length > 0) {
    throw new Error(
      `${label} keyboard labels are clipped: ${JSON.stringify(metrics.clipped)}`,
    );
  }
  if (metrics.scrollWidth > metrics.clientWidth + 2) {
    throw new Error(
      `${label} has horizontal overflow: ${JSON.stringify(metrics)}`,
    );
  }
}

async function assertLandscapePlacement(page) {
  const metrics = await page.evaluate(() => {
    const workbench = document
      .querySelector("#workbench")
      .getBoundingClientRect();
    const keyboard = document
      .querySelector("#keyboard-layout")
      .getBoundingClientRect();
    return {
      workbenchRight: workbench.right,
      keyboardLeft: keyboard.left,
      keyboardWidth: keyboard.width,
      keyboardHeight: keyboard.height,
    };
  });

  if (metrics.keyboardLeft < metrics.workbenchRight - 2) {
    throw new Error(
      `Landscape keyboard is not to the right: ${JSON.stringify(metrics)}`,
    );
  }
  if (metrics.keyboardWidth < 300 || metrics.keyboardHeight < 180) {
    throw new Error(
      `Landscape keyboard is not large enough: ${JSON.stringify(metrics)}`,
    );
  }
}

async function assertPortraitPlacement(page) {
  const metrics = await page.evaluate(() => {
    const candidate = document
      .querySelector("#candidate-area")
      .getBoundingClientRect();
    const keyboard = document
      .querySelector("#keyboard-layout")
      .getBoundingClientRect();
    return {
      candidateBottom: candidate.bottom,
      keyboardTop: keyboard.top,
      keyboardWidth: keyboard.width,
      keyboardHeight: keyboard.height,
    };
  });

  if (metrics.keyboardTop < metrics.candidateBottom - 2) {
    throw new Error(
      `Portrait keyboard is not below candidates: ${JSON.stringify(metrics)}`,
    );
  }
  if (metrics.keyboardWidth < 320 || metrics.keyboardHeight < 170) {
    throw new Error(
      `Portrait keyboard is not large enough: ${JSON.stringify(metrics)}`,
    );
  }
}

async function holdPressedKeys(page) {
  await page.keyboard.down("Shift");
  await page.keyboard.down("a");
  await page.waitForFunction(() => {
    const shiftCount = document.querySelectorAll(
      '.qwerty-key.is-pressed[data-key="Shift"]',
    ).length;
    return (
      shiftCount === 2 &&
      !!document.querySelector('.qwerty-key.is-pressed[data-key="a"]')
    );
  });

  const summary = await page.$eval(
    "#keyboard-pressed-summary",
    (el) => el.textContent || "",
  );
  if (!summary.includes("Shift") || !summary.includes("A")) {
    throw new Error(
      `Pressed-key summary did not include held keys: ${summary}`,
    );
  }
}

async function releasePressedKeys(page) {
  await page.keyboard.up("a");
  await page.keyboard.up("Shift");
  await page.waitForFunction(
    () => document.querySelectorAll(".qwerty-key.is-pressed").length === 0,
  );
}

async function exerciseViewport(browser, baseUrl, viewport, mode) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#qwerty-board .qwerty-key");
  await toggleKeyboard(page);

  if (mode === "landscape") {
    await assertLandscapePlacement(page);
  } else {
    await assertPortraitPlacement(page);
  }
  await holdPressedKeys(page);
  await assertLegible(page, mode);

  const screenshotPath = path.join(SCREENSHOT_DIR, `${mode}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await releasePressedKeys(page);
  await page.close();
  return screenshotPath;
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const { server, baseUrl } = await startStaticServer();
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const screenshots = [];
    screenshots.push(
      await exerciseViewport(
        browser,
        baseUrl,
        { width: 1100, height: 700 },
        "landscape",
      ),
    );
    screenshots.push(
      await exerciseViewport(
        browser,
        baseUrl,
        { width: 390, height: 760 },
        "portrait",
      ),
    );
    console.log(`Keyboard layout screenshots:\n${screenshots.join("\n")}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
