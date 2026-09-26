const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const puppeteer = require("puppeteer");

async function main() {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.basename(pathname === "/" ? "index.html" : pathname);
    try {
      const body = await fs.readFile(path.join(__dirname, "../static", file));
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "application/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    const text = () => page.$eval("#text-display", (el) => el.textContent);
    const shortcut = async (modifier, digit) => {
      await page.keyboard.down(modifier);
      await page.keyboard.press(String(digit));
      await page.keyboard.up(modifier);
    };
    await page.keyboard.type("123");
    assert.equal(await text(), "123");
    for (let i = 0; i < 10; i++) await shortcut("Alt", i);
    await shortcut("Control", 0);
    assert.equal(await text(), "123123");
    await page.keyboard.press("Space");
    assert.equal(await text(), "123");
    // Copy selection rather than the entire buffer.
    await page.evaluate(() => {
      const range = document.createRange();
      const flow = document.querySelector("#text-display");
      range.selectNodeContents(flow);
      range.setEnd(flow.firstChild, 1);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await shortcut("Alt", 4);
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await shortcut("Control", 4);
    assert.equal(await text(), "1231");
    await page.keyboard.press("Space");
    assert.equal(await text(), "123");
    // Holding a shortcut inserts only once.
    await page.keyboard.down("Control");
    await page.keyboard.down("9");
    await page.keyboard.down("9");
    await page.keyboard.up("9");
    await page.keyboard.up("Control");
    assert.equal(await text(), "123123");
    await page.keyboard.press("Space");
    assert.equal(await text(), "123");
    await page.reload();
    await shortcut("Control", 9);
    assert.equal(await text(), "123");
    await page.click("#clipboard-slots summary");
    await page.click('[aria-label="Clear slot 9"]');
    await shortcut("Control", 9);
    assert.equal(await text(), "123");
    assert.match(
      await page.$eval("#clipboard-slot-status", (el) => el.textContent),
      /empty/,
    );
    await page.click('[aria-label="Paste slot 1"]');
    assert.equal(await text(), "123123");
    await page.keyboard.press("Space");
    assert.equal(await text(), "123");
    // A V7 mode change hides the panel and releases shortcut interception.
    await page.keyboard.down("a");
    await page.keyboard.down("q");
    await page.keyboard.up("q");
    await page.keyboard.up("a");
    await page.waitForFunction(
      () => document.querySelector("#text-input").offsetHeight > 0,
    );
    assert.equal(await page.$eval("#clipboard-slots", (el) => el.hidden), true);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.$eval("#clipboard-slots", (el) => el.hidden),
      false,
    );
    await page.click("#clipboard-slots details > button");
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("v7.clipboard-slots.v1")),
    );
    assert.deepEqual(saved, Array(10).fill(null));
    await page.setViewport({ width: 360, height: 640 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    const ime = await browser.newPage();
    await ime.setViewport({ width: 360, height: 260 });
    await ime.evaluateOnNewDocument(() => {
      window.__preedits = [];
      window.__height = 0;
      window.__slotsEnabled = false;
      window.AndroidIme = {
        setClipboardSlotsEnabled: (enabled) => {
          window.__slotsEnabled = enabled;
        },
        getInferenceModelError: () => "",
        getInferenceModelState: () => "loading",
        hasPloverConfiguration: () => false,
        isStenoModeEnabled: () => true,
        isTelexModeEnabled: () => false,
        isRawOutlineMode: () => false,
        isPlainTextMode: () => false,
        getInputGeneration: () => 0,
        setKeyboardHeight: (height) => {
          window.__height = height;
        },
        setPreeditText: (text) => {
          window.__preedits.push(text);
        },
      };
    });
    await ime.goto(`${url}/ime.html`);
    const androidKey = async (key, ctrl = false, alt = false, epoch = 0) => {
      await ime.evaluate(
        ({ key, ctrl, alt, epoch }) => {
          const code = key === " " ? "Space" : `Digit${key}`;
          for (const action of ["keydown", "keyup"]) {
            window.handleAndroidKeyEvent(
              action,
              key,
              code,
              false,
              false,
              ctrl,
              alt,
              false,
              false,
              epoch,
            );
          }
        },
        { key, ctrl, alt, epoch },
      );
    };
    await androidKey("7");
    await androidKey("0", false, true);
    await androidKey("0", true);
    assert.equal(await ime.evaluate(() => window.__preedits.at(-1)), "77");
    await androidKey(" ");
    assert.equal(await ime.evaluate(() => window.__preedits.at(-1)), "7");
    await ime.reload();
    await androidKey("0", true);
    assert.equal(await ime.evaluate(() => window.__preedits.at(-1)), "7");
    const visible = async () => {
      const shown = await ime.$eval("#clipboard-slots", (el) => !el.hidden);
      assert.equal(await ime.evaluate(() => window.__slotsEnabled), shown);
      return shown;
    };
    assert.equal(await visible(), true);
    await ime.evaluate(() =>
      window.handleAndroidStenoModeChanged(false, false, 1),
    );
    assert.equal(await visible(), false);
    await ime.evaluate(() =>
      window.handleAndroidStenoModeChanged(false, true, 2),
    );
    assert.equal(await visible(), false);
    await ime.evaluate(() =>
      window.handleAndroidStenoModeChanged(true, false, 3),
    );
    assert.equal(await visible(), true);
    await ime.evaluate(() =>
      window.handleAndroidEditorModeChanged(true, false),
    );
    assert.equal(await visible(), false);
    await ime.evaluate(() =>
      window.handleAndroidEditorModeChanged(false, false),
    );
    assert.equal(await visible(), true);
    await androidKey("0", true, false, 0); // stale input epoch must be ignored
    assert.equal(await ime.evaluate(() => window.__preedits.at(-1)), "7");
    await ime.click("#clipboard-slots summary");
    await ime.click('[aria-label="Clear slot 0"]');
    await ime.reload();
    await androidKey("0", true);
    assert.match(
      await ime.$eval("#clipboard-slot-status", (el) => el.textContent),
      /empty/,
    );
    assert.equal(
      await ime.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    console.log("Clipboard slots browser checks passed.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
