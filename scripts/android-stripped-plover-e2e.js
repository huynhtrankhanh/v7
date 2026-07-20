const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const assetRoots = [
  path.resolve(
    __dirname,
    "../ime-android/app/build/generated/strippedPloverWeb",
  ),
  path.resolve(__dirname, "../ime-android/app/build/generated/v7WebUi"),
];

function contentType(filename) {
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filename.endsWith(".wasm")) return "application/wasm";
  if (filename.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

async function requestRuntime(page, requestId, method, params = {}) {
  await page.evaluate(
    ({ requestId, method, params }) => {
      window.StrippedPloverAndroidRuntime.request(
        requestId,
        JSON.stringify({ id: requestId, method, params }),
      );
    },
    { requestId, method, params },
  );
  await page.waitForFunction(
    (expectedRequestId) =>
      window.__runtimeResults.some(
        (result) => result.requestId === expectedRequestId,
      ),
    { timeout: 120_000 },
    requestId,
  );
  const bridgeResult = await page.evaluate((expectedRequestId) => {
    const index = window.__runtimeResults.findIndex(
      (candidate) => candidate.requestId === expectedRequestId,
    );
    return window.__runtimeResults.splice(index, 1)[0];
  }, requestId);
  if (bridgeResult.error) {
    throw new Error(`bundled runtime returned an error: ${bridgeResult.error}`);
  }
  const response = JSON.parse(bridgeResult.response);
  if (response.error) {
    throw new Error(
      `Stripped Plover RPC ${method} failed: ${response.error.message}`,
    );
  }
  return response.result;
}

async function main() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname,
    );
    const assetPath = requestPath.startsWith("/assets/")
      ? requestPath.slice("/assets".length)
      : requestPath;
    const filename = assetRoots
      .map((root) => path.resolve(root, `.${assetPath}`))
      .find(
        (candidate, index) =>
          candidate.startsWith(`${assetRoots[index]}${path.sep}`) &&
          fs.existsSync(candidate) &&
          !fs.statSync(candidate).isDirectory(),
      );
    if (!filename) {
      if (requestPath === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      console.error("Runtime asset not found:", requestPath);
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType(filename),
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    fs.createReadStream(filename).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        console.error(`Runtime console ${message.type()}:`, message.text());
      }
    });
    page.on("pageerror", (error) => {
      console.error("Runtime page error:", error.message);
    });
    page.on("requestfailed", (request) => {
      console.error(
        "Runtime request failed:",
        request.url(),
        request.failure()?.errorText,
      );
    });
    page.on("workercreated", async (worker) => {
      worker.client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
        console.error(
          "Runtime worker error:",
          exceptionDetails.exception?.description ?? exceptionDetails.text,
        );
      });
      await worker.client.send("Runtime.enable");
    });
    await page.evaluateOnNewDocument(() => {
      window.__runtimeResults = [];
      window.__sqliteExec = [];
      window.AndroidStrippedPloverRuntime = {
        onReady() {
          window.__runtimeReady = true;
        },
        onResponse(requestId, response, error) {
          window.__runtimeResults.push({ requestId, response, error });
        },
      };
      window.AndroidStrippedPloverSqlite = {
        open() {},
        exec(sql) {
          window.__sqliteExec.push(sql);
        },
        query(sql) {
          if (/COUNT\(\*\)/i.test(sql)) {
            return JSON.stringify([{ count: 0 }]);
          }
          return "[]";
        },
        run() {
          return JSON.stringify({ changes: 1, lastInsertRowid: 1 });
        },
      };
    });
    await page.goto(
      `http://127.0.0.1:${port}/assets/stripped-plover-runtime.html`,
      {
        waitUntil: "load",
      },
    );
    await page.waitForFunction(
      () =>
        window.__runtimeReady === true ||
        window.__runtimeResults.some((result) => result.requestId === 0),
    );
    const startupError = await page.evaluate(() =>
      window.__runtimeResults.find((result) => result.requestId === 0),
    );
    if (startupError) {
      throw new Error(`bundled runtime failed to start: ${startupError.error}`);
    }

    const isolated = await page.evaluate(() => crossOriginIsolated);
    if (!isolated) {
      throw new Error("runtime page is not cross-origin isolated");
    }
    const parsed = await requestRuntime(page, 7, "get_dictionary_state");
    if (!parsed || !Array.isArray(parsed.dictionaries)) {
      throw new Error(`unexpected dictionary state: ${JSON.stringify(parsed)}`);
    }

    const pythonCode = `
LONGEST_KEY = 1

DICTIONARY = {
    ('TEFT',): 'browser-python-works',
}

def lookup(key):
    if key in DICTIONARY:
        return DICTIONARY[key]
    raise KeyError(key)
`;
    const imported = await requestRuntime(page, 8, "import_dictionary", {
      name: "browser-python-test",
      type: "python",
      pythonCode,
    });
    if (imported.type !== "python" || imported.entries !== 1) {
      throw new Error(
        `unexpected Python dictionary import: ${JSON.stringify(imported)}`,
      );
    }
    const translation = await requestRuntime(page, 9, "translate", {
      stroke: "TEFT",
    });
    if (
      !Array.isArray(translation.output) ||
      !translation.output.some(
        (element) =>
          element.type === "preedit" && element.text === "browser-python-works",
      )
    ) {
      throw new Error(
        `Python dictionary did not translate: ${JSON.stringify(translation)}`,
      );
    }

    const initializedSchema = await page.evaluate(() =>
      window.__sqliteExec.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS dictionaries"),
      ),
    );
    if (!initializedSchema) {
      throw new Error("Stripped Plover did not initialize its SQLite schema");
    }
    console.log("Bundled Android Stripped Plover runtime passed");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
