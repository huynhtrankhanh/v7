#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const STATIC_DIR = path.join(ROOT, "static");
const SCREENSHOT_DIR = process.env.V7_SCREENSHOT_DIR || "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    const filename = path.normalize(path.join(STATIC_DIR, pathname));
    if (!filename.startsWith(`${STATIC_DIR}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    fs.readFile(filename, (error, data) => {
      if (error) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": filename.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : filename.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/html; charset=utf-8",
      });
      response.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

async function installAndroidBridge(page) {
  await page.evaluateOnNewDocument(() => {
    window.AndroidDictionary = {
      hasPloverConfiguration: () => true,
      requestPlover(body, requestId) {
        const request = JSON.parse(body);
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
              {
                identifier: "very-long-user-dictionary-name.json",
                enabled: false,
                readonly: false,
                entries: 12345,
              },
            ],
          },
          enumerate_entries: {
            page: 1,
            total: 2,
            has_more: false,
            entries: [
              {
                dictionary: "main.json",
                stroke: "TEFT",
                translation: "test",
              },
              {
                dictionary: "main.json",
                stroke: "PHRAOEUFR",
                translation: "a long translation that must wrap safely",
              },
            ],
          },
        };
        setTimeout(() => {
          window.handleAndroidPloverResponse(
            requestId,
            JSON.stringify({
              id: request.id,
              result: results[request.method] || {},
            }),
            "",
          );
        });
      },
      saveDictionaryFile() {},
      close() {},
    };
  });
}

async function capture(page, name) {
  if (!SCREENSHOT_DIR) return;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: false,
  });
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const content = document.querySelector(".plover-dialog-content");
    const navigation = document.querySelector(".plover-dialog-nav");
    const dialog = document.querySelector("#plover-dictionary-dialog");
    const tabs = document.querySelector(".plover-tabs");
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const intersects = (left, right) => {
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return (
        Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
      );
    };
    const groups = [
      ".plover-dialog-header",
      ".plover-tabs",
      ".plover-section-heading",
      ".plover-dictionary-title",
      ".plover-dictionary-actions",
      ".plover-entry-buttons",
    ];
    const overlaps = [];
    for (const selector of groups) {
      for (const group of document.querySelectorAll(selector)) {
        const children = [...group.children].filter(visible);
        for (let left = 0; left < children.length; left += 1) {
          for (let right = left + 1; right < children.length; right += 1) {
            if (intersects(children[left], children[right])) {
              overlaps.push(
                `${selector}: ${children[left].textContent?.trim()} / ${children[right].textContent?.trim()}`,
              );
            }
          }
        }
      }
    }
    const tabsRect = tabs.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const navigationRect = navigation.getBoundingClientRect();
    const obscuredTabs = [...tabs.children]
      .filter(visible)
      .filter((tab) => {
        const rect = tab.getBoundingClientRect();
        return (
          rect.left < tabsRect.left - 1 ||
          rect.right > tabsRect.right + 1 ||
          rect.top < tabsRect.top - 1 ||
          rect.bottom > tabsRect.bottom + 1
        );
      })
      .map((tab) => tab.textContent.trim());
    const horizontallyClipped = [
      ...document.querySelectorAll("button, input, select"),
    ]
      .filter(visible)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > window.innerWidth + 1;
      })
      .map(
        (element) =>
          element.id || element.textContent?.trim() || element.tagName,
      );
    return {
      contentScrollLeft: content.scrollLeft,
      contentScrollTop: content.scrollTop,
      windowScrollY: window.scrollY,
      visualViewportTop: window.visualViewport?.offsetTop || 0,
      dialogTop: dialogRect.top,
      contentTop: contentRect.top,
      navigationObscured:
        navigationRect.top < contentRect.top - 1 ||
        navigationRect.bottom > contentRect.bottom + 1,
      horizontalPageOverflow: content.scrollWidth > content.clientWidth + 1,
      tabOverflow: tabs.scrollWidth > tabs.clientWidth + 1,
      obscuredTabs,
      horizontallyClipped,
      overlaps,
    };
  });
}

async function main() {
  const { server, url } = await startStaticServer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await installAndroidBridge(page);
    for (const scenario of [
      { width: 412, height: 732, scale: 1.5 },
      { width: 320, height: 640, scale: 2 },
    ]) {
      await page.setViewport({
        width: scenario.width,
        height: scenario.height,
        deviceScaleFactor: 1,
      });
      await page.goto(`${url}/dictionary.html?dictionary-management=1`, {
        waitUntil: "networkidle0",
      });
      await page.waitForFunction(
        () =>
          document.querySelector("#plover-dictionary-dialog")?.open &&
          document.querySelectorAll(".plover-dictionary-item").length === 2,
      );
      await page.addStyleTag({
        content: `html { font-size: ${scenario.scale * 100}%; }`,
      });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const prefix = `${scenario.width}px-${scenario.scale}x`;
      for (const panel of ["dictionaries", "entries", "lookup"]) {
        if (panel !== "dictionaries") {
          await page.click(`#plover-tab-${panel}`);
          await page.waitForFunction(
            (panelName) =>
              document
                .querySelector(`#plover-panel-${panelName}`)
                ?.classList.contains("active"),
            {},
            panel,
          );
        }
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const layout = await inspectLayout(page);
        assert(
          layout.contentScrollTop === 0 &&
            layout.windowScrollY === 0 &&
            layout.visualViewportTop === 0 &&
            layout.dialogTop >= -1 &&
            layout.contentTop >= -1 &&
            !layout.navigationObscured &&
            !layout.horizontalPageOverflow &&
            !layout.tabOverflow &&
            layout.obscuredTabs.length === 0 &&
            layout.horizontallyClipped.length === 0 &&
            layout.overlaps.length === 0,
          `${prefix} ${panel} layout overlaps or clips controls: ${JSON.stringify(layout)}`,
        );
        await capture(page, `${prefix}-${panel}`);
      }
    }
    console.log("Android dictionary layouts do not overlap or clip");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
