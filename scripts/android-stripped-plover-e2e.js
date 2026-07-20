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

async function main() {
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname,
    );
    const filename = assetRoots
      .map((root) => path.resolve(root, `.${requestPath}`))
      .find(
        (candidate, index) =>
          candidate.startsWith(`${assetRoots[index]}${path.sep}`) &&
          fs.existsSync(candidate) &&
          !fs.statSync(candidate).isDirectory(),
      );
    if (!filename) {
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
    page.on("pageerror", (error) => {
      console.error("Runtime page error:", error.message);
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
    await page.goto(`http://127.0.0.1:${port}/stripped-plover-runtime.html`, {
      waitUntil: "load",
    });
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
    await page.evaluate(() => {
      window.StrippedPloverAndroidRuntime.request(
        7,
        JSON.stringify({
          id: "dictionary-state",
          method: "get_dictionary_state",
          params: {},
        }),
      );
    });
    await page.waitForFunction(() =>
      window.__runtimeResults.some((result) => result.requestId === 7),
    );
    const result = await page.evaluate(() =>
      window.__runtimeResults.find((candidate) => candidate.requestId === 7),
    );
    if (result.error) {
      throw new Error(`bundled runtime returned an error: ${result.error}`);
    }
    const parsed = JSON.parse(result.response);
    if (
      parsed.id !== "dictionary-state" ||
      !parsed.result ||
      !Array.isArray(parsed.result.dictionaries)
    ) {
      throw new Error(`unexpected runtime response: ${result.response}`);
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
