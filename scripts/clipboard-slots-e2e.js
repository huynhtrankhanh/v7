const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const puppeteer = require("puppeteer");

async function main() {
  // Simulate native app storage outside the browser profile, including Settings writes.
  const nativeSlots = Array(10).fill(null);
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/native-slots") {
      if (req.method === "PUT") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { slot, text } = JSON.parse(body);
        nativeSlots[slot] = text || null;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(nativeSlots));
      return;
    }
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
    const ime = await browser.newPage();
    const errors = [];
    ime.on("pageerror", (error) => errors.push(error.message));
    await ime.setViewport({ width: 360, height: 260 });
    await ime.evaluateOnNewDocument(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("WebView storage disabled");
        },
      });
      const request = (method, body) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, "/native-slots", false);
        xhr.send(body ? JSON.stringify(body) : null);
        return xhr.responseText;
      };
      window.__preedits = [];
      window.__messages = [];
      window.__ploverRequests = [];
      window.__ploverContext = "";
      window.__delayReset = 0;
      window.AndroidIme = {
        getClipboardSlots: () => request("GET"),
        setClipboardSlot: (slot, text) => {
          request("PUT", { slot, text });
          return true;
        },
        showClipboardMessage: (text) => window.__messages.push(text),
        getInferenceModelError: () => "",
        getInferenceModelState: () => "loading",
        hasPloverConfiguration: () => true,
        isStenoModeEnabled: () => true,
        isTelexModeEnabled: () => false,
        isRawOutlineMode: () => false,
        isPlainTextMode: () => false,
        getInputGeneration: () => 0,
        setKeyboardHeight() {},
        setPreeditText: (text) => window.__preedits.push(text),
        requestPlover(body, requestId) {
          const rpc = JSON.parse(body);
          window.__ploverRequests.push(rpc.method);
          let result = {};
          if (rpc.method === "get_dictionary_state")
            result = { dictionaries: [], solo: false };
          if (rpc.method === "translate") {
            window.__ploverContext =
              rpc.params.stroke === "*"
                ? window.__ploverContext.split(" ").slice(0, -1).join(" ")
                : window.__ploverContext +
                  (window.__ploverContext ? " chào" : "xin");
            result = {
              output: [{ type: "preedit", text: window.__ploverContext }],
            };
          }
          const respond = () => {
            if (rpc.method === "reset_state") window.__ploverContext = "";
            window.handleAndroidPloverResponse(
              requestId,
              JSON.stringify({ result }),
              "",
            );
          };
          setTimeout(
            respond,
            rpc.method === "reset_state" ? window.__delayReset : 10,
          );
        },
      };
    });
    const url = `http://127.0.0.1:${server.address().port}/ime.html`;
    await ime.goto(url);
    const key = async (
      text,
      code = text === " "
        ? "Space"
        : /^[0-9]$/.test(text)
          ? `Digit${text}`
          : `Key${text.toUpperCase()}`,
    ) => {
      await ime.evaluate(
        ({ text, code }) => {
          for (const action of ["keydown", "keyup"])
            window.handleAndroidKeyEvent(
              action,
              text,
              code,
              false,
              false,
              false,
              false,
              false,
              false,
              window.__epoch || 0,
            );
        },
        { text, code },
      );
    };
    const slot = async (number, copy = false, selectedText = null, epoch) => {
      await ime.evaluate(
        ({ number, copy, selectedText, epoch }) => {
          window.handleAndroidClipboardSlot(
            number,
            copy,
            epoch ?? (window.__epoch || 0),
            selectedText,
          );
        },
        { number, copy, selectedText, epoch },
      );
    };
    const waitText = (text) =>
      ime.waitForFunction(
        (expected) => window.__preedits.at(-1) === expected,
        {},
        text,
      );
    const height = () =>
      ime.$eval(
        "#clipboard-slots",
        (element) => element.getBoundingClientRect().height,
      );
    assert.equal(await height(), 0);
    await key("7");
    await waitText("7");
    await slot(0, true);
    await ime.waitForFunction(() =>
      window.__messages.at(-1)?.includes("Copied"),
    );
    assert.equal(nativeSlots[0], "7");
    await slot(0);
    await waitText("77");
    await key(" ");
    await waitText("7");
    await slot(1, true, "\n chào!  ");
    await ime.waitForFunction(() =>
      window.__messages.at(-1)?.includes("slot 1"),
    );
    assert.equal(nativeSlots[1], "\n chào!  ");
    await ime.reload();
    await slot(1);
    await waitText("\n chào!  ");
    assert.ok((await height()) > 0);

    // Native Settings can edit slots while the same WebView remains alive.
    nativeSlots[1] = " saved ";
    await ime.evaluate(() => window.refreshClipboardSlotsFromAndroid());
    await ime.evaluate(() => window.clearPreeditFromAndroid(0));
    await slot(1);
    await waitText(" saved ");
    await ime.evaluate(() => window.clearPreeditFromAndroid(0));
    await ime.waitForFunction(
      () =>
        document.getElementById("plover-status")?.textContent === "Available",
    );
    await key("q"); // # toggles Plover
    await ime.waitForFunction(
      () => document.getElementById("plover-status")?.textContent === "Enabled",
    );
    await key("a");
    await waitText("xin");
    await ime.evaluate(() => {
      window.__delayReset = 80;
    });
    await slot(1);
    await key("a"); // Must wait for reset and paste before translating the next stroke.
    await waitText("xin saved xin");
    const requests = await ime.evaluate(() => window.__ploverRequests);
    assert.deepEqual(requests.slice(-3), [
      "translate",
      "reset_state",
      "translate",
    ]);
    await key(" "); // Undo the fresh Plover translation.
    await waitText("xin saved ");
    await key(" "); // Then undo the paste without reviving Plover snapshots.
    await waitText("xin");
    await ime.evaluate(() => window.clearPreeditFromAndroid(0));
    await slot(1);
    await waitText(" saved ");
    await key(" "); // Plover boundary undo removes paste without sending * to its empty runtime.
    await waitText("");
    await slot(1);
    await waitText(" saved ");
    await slot(1, false, null, 99); // stale native callbacks cannot paste
    assert.equal(await ime.evaluate(() => window.__preedits.at(-1)), " saved ");

    for (const mode of [
      [false, false],
      [false, true],
    ]) {
      await ime.evaluate(
        ([steno, telex]) =>
          window.handleAndroidStenoModeChanged(steno, telex, 0),
        mode,
      );
      assert.equal(await height(), 0);
    }
    await ime.evaluate(() =>
      window.handleAndroidStenoModeChanged(true, false, 0),
    );
    nativeSlots.fill(null);
    await ime.evaluate(() =>
      window.handleAndroidStenoModeChanged(true, false, 0),
    );
    assert.equal(await height(), 0);
    await slot(3);
    await ime.waitForFunction(() =>
      window.__messages.at(-1)?.includes("empty"),
    );
    assert.equal(await height(), 0);
    assert.equal(
      await ime.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Android native clipboard: storage, host selection copy, V7/Plover paste, serialized reset, undo, empty layout, and mode checks passed.",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
