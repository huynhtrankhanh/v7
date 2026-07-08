#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const STATIC_DIR = path.join(ROOT, "static");
const TEXT_ZOOM_PX = 32;

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

async function applyTextZoom(page) {
  await page.addStyleTag({
    content: `html { font-size: ${TEXT_ZOOM_PX}px !important; }`,
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => {
    function describe(el) {
      const id = el.id ? `#${el.id}` : "";
      const classes = Array.from(el.classList || []).map((name) => `.${name}`).join("");
      return `${el.tagName.toLowerCase()}${id}${classes}`;
    }

    const root = document.scrollingElement || document.documentElement;
    const viewportWidth = root.clientWidth;
    const offenders = [];

    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > viewportWidth + 2) {
        offenders.push({
          selector: describe(el),
          right: Math.round(rect.right),
          viewportWidth,
          text: (el.textContent || "").trim().slice(0, 80),
        });
      }
    }

    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      offenders: offenders.slice(0, 5),
    };
  });

  if (metrics.scrollWidth > metrics.clientWidth + 2) {
    throw new Error(`${label} has horizontal overflow: ${JSON.stringify(metrics)}`);
  }
}

async function assertScrollable(page, selector, label) {
  const metrics = await page.$eval(selector, (el) => {
    el.scrollTop = 0;
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    return {
      before,
      after: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflowY: getComputedStyle(el).overflowY,
    };
  });

  if (metrics.clientHeight < 48) {
    throw new Error(`${label} collapsed under text zoom: ${JSON.stringify(metrics)}`);
  }
  if (metrics.scrollHeight > metrics.clientHeight + 2 && metrics.after <= metrics.before) {
    throw new Error(`${label} cannot scroll under text zoom: ${JSON.stringify(metrics)}`);
  }
}

async function exerciseMainWebUi(baseUrl, browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 640, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#candidate-area");
  await applyTextZoom(page);

  await page.evaluate(() => {
    const display = document.querySelector("#text-display");
    const candidates = document.querySelector("#candidate-area");
    if (!display || !candidates) throw new Error("Main UI targets not found");

    display.replaceChildren();
    display.appendChild(document.createTextNode(
      Array.from({ length: 90 }, (_, i) => `dong-${i} tieng-viet`).join(" ")
    ));

    candidates.classList.add("horizontal");
    candidates.replaceChildren();
    for (let i = 0; i < 12; i += 1) {
      const row = document.createElement("div");
      row.className = "candidate";
      const number = document.createElement("sup");
      number.textContent = String(i + 1);
      const text = document.createElement("span");
      text.className = "candidate-text";
      text.textContent = `ung-vien-${i}-voi-chuoi-goi-y-dai-de-kiem-tra-wrap-va-scroll`;
      row.append(number, document.createTextNode(" "), text);
      candidates.appendChild(row);
    }
  });

  await assertNoHorizontalOverflow(page, "main web UI");
  await assertScrollable(page, "#text-display", "main text display");
  await assertScrollable(page, "#candidate-area", "candidate area");
  await page.close();
}

async function exercisePracticeUi(baseUrl, browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 640, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/practice.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#target");
  await applyTextZoom(page);

  await page.evaluate(() => {
    const target = document.querySelector("#target");
    if (!target) throw new Error("Practice target not found");

    target.replaceChildren();
    const words = [
      "nghieng", "truyen", "khuya", "chuong", "thuan", "quyen", "vang", "thich",
      "nhanh", "luong", "xuyen", "phuong", "rieng", "song", "tieng", "dung",
      "kiem", "ngang", "choi", "nhom", "giong", "vuon",
    ];
    words.forEach((word, index) => {
      const token = document.createElement("span");
      token.className = index === 0 ? "word-token current current-unit" : "word-token";
      token.textContent = word;
      if (index === 0) token.dataset.unit = "SKWH";
      target.appendChild(token);
    });
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

  const wordWall = await page.$eval("#target", (el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  if (wordWall.overflowY === "hidden" && wordWall.scrollHeight > wordWall.clientHeight + 2) {
    throw new Error(`Practice word wall clips text under zoom: ${JSON.stringify(wordWall)}`);
  }

  await assertNoHorizontalOverflow(page, "practice UI");
  await page.close();
}

async function main() {
  const { server, baseUrl } = await startStaticServer();
  let browser;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    await exerciseMainWebUi(baseUrl, browser);
    await exercisePracticeUi(baseUrl, browser);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
