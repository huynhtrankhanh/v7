const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const puppeteer = require("puppeteer");

async function main() {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = path.basename(pathname === "/" ? "ime.html" : pathname);
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
    const url = `http://127.0.0.1:${server.address().port}`;
    const errors = [];
    const ime = await browser.newPage();
    ime.on("pageerror", (error) => errors.push(error.message));
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
    assert.deepEqual(errors, []);
    console.log("Android IME clipboard slot checks passed.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
