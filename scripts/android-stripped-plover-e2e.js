const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const puppeteer = require("puppeteer");

const assetRoots = [
  path.resolve(
    __dirname,
    "../ime-android/app/build/generated/strippedPloverWeb",
  ),
  path.resolve(__dirname, "../static"),
  path.resolve(__dirname, "../ime-android/app/build/generated/v7WebUi"),
];

function contentType(filename) {
  if (filename.endsWith(".html")) return "text/html; charset=utf-8";
  if (filename.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filename.endsWith(".wasm")) return "application/wasm";
  if (filename.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

async function dispatchRuntimeBody(page, requestId, body) {
  await page.bringToFront();
  await page.evaluate(
    ({ requestId, body }) => {
      window.StrippedPloverAndroidRuntime.request(requestId, body);
    },
    { requestId, body },
  );
  try {
    await page.waitForFunction(
      (expectedRequestId) =>
        window.__runtimeResults.some(
          (result) => result.requestId === expectedRequestId,
        ),
      { timeout: 120_000 },
      requestId,
    );
  } catch (error) {
    const diagnostics = await page.evaluate((expectedRequestId) => {
      return window.__runtimeDiagnostics.filter(
        (diagnostic) =>
          diagnostic.requestId === 0 ||
          diagnostic.requestId === expectedRequestId,
      );
    }, requestId);
    throw new Error(
      `runtime request ${requestId} timed out: ${error.message}; diagnostics=${JSON.stringify(diagnostics)}`,
    );
  }
  return page.evaluate((expectedRequestId) => {
    const index = window.__runtimeResults.findIndex(
      (candidate) => candidate.requestId === expectedRequestId,
    );
    return window.__runtimeResults.splice(index, 1)[0];
  }, requestId);
}

async function requestRuntime(page, requestId, method, params = {}) {
  const bridgeResult = await dispatchRuntimeBody(
    page,
    requestId,
    JSON.stringify({ id: requestId, method, params }),
  );
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

async function uploadDictionary(page, directory, filename, content, type) {
  const uploadPath = path.join(directory, filename);
  fs.writeFileSync(uploadPath, content);
  const input = await page.$("#plover-dict-file");
  if (!input) {
    throw new Error("Android dictionary file input was not found");
  }
  await input.uploadFile(uploadPath);
  await page.waitForFunction(
    (expectedType) =>
      document.querySelector("#plover-dict-type")?.value === expectedType,
    {},
    type,
  );
  await page.click("#plover-dict-upload");
  await page.waitForFunction(
    () => document.querySelector("#plover-dict-upload")?.disabled === true,
  );
  await page.waitForFunction(
    () => document.querySelector("#plover-dict-upload")?.disabled === false,
    { timeout: 120_000 },
  );
  const errorMessage = await page.$eval(
    "#plover-message",
    (element) => element.textContent?.trim() || "",
  );
  if (errorMessage) {
    throw new Error(
      `Android ${type} dictionary upload failed: ${errorMessage}`,
    );
  }
}

async function main() {
  const emulateNonIsolatedWebView =
    process.env.V7_TEST_NON_ISOLATED_WEBVIEW === "1";
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const requestPath = decodeURIComponent(requestUrl.pathname);
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
    const headers = {
      "Content-Type": contentType(filename),
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (!(
      emulateNonIsolatedWebView &&
      requestPath.endsWith("/stripped-plover-runtime.html")
    )) {
      headers["Cross-Origin-Opener-Policy"] = "same-origin";
      headers["Cross-Origin-Embedder-Policy"] = "require-corp";
    }
    response.writeHead(200, headers);
    fs.createReadStream(filename).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
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
      window.__runtimeDiagnostics = [];
      window.__sqliteExec = [];
      window.AndroidStrippedPloverRuntime = {
        onReady() {
          window.__runtimeReady = true;
        },
        onResponse(requestId, response, error) {
          window.__runtimeResults.push({ requestId, response, error });
        },
        onDiagnostic(requestId, phase, detail) {
          window.__runtimeDiagnostics.push({ requestId, phase, detail });
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
          if (/SELECT MAX\(/i.test(sql)) {
            return JSON.stringify([{ maxLen: null }]);
          }
          return "[]";
        },
        run() {
          return JSON.stringify({ changes: 1, lastInsertRowid: 1 });
        },
      };
    });
    await page.goto(
      `http://127.0.0.1:${port}/assets/stripped-plover-runtime.html${
        emulateNonIsolatedWebView ? "?non-isolated-webview=1" : ""
      }`,
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
    if (isolated === emulateNonIsolatedWebView) {
      throw new Error(
        `runtime page isolation did not match the test mode: ${isolated}`,
      );
    }
    const parsed = await requestRuntime(page, 7, "get_dictionary_state");
    if (!parsed || !Array.isArray(parsed.dictionaries)) {
      throw new Error(`unexpected dictionary state: ${JSON.stringify(parsed)}`);
    }

    const managementPage = await browser.newPage();
    const forwardedRequests = [];
    let nextRuntimeRequestId = 100;
    await managementPage.evaluateOnNewDocument(() => {
      // Exercise the FileReader compatibility path used by older WebViews.
      Object.defineProperty(File.prototype, "text", {
        configurable: true,
        value: undefined,
      });
      window.__androidPloverRequestQueue = [];
      window.__completedAndroidPloverMethods = [];
      window.AndroidDictionary = {
        hasPloverConfiguration() {
          return true;
        },
        requestPlover(body, requestId) {
          window.__androidPloverRequestQueue.push({ body, requestId });
        },
        getDiagnostics() {
          return "simulated Android diagnostics";
        },
        clearDiagnostics() {},
        copyDiagnostics() {},
        recordDiagnostic() {},
        saveDictionaryFile() {},
        close() {},
      };
    });
    await managementPage.goto(
      `http://127.0.0.1:${port}/assets/dictionary.html?dictionary-management=1`,
      { waitUntil: "load" },
    );
    await managementPage.waitForSelector("#plover-dictionary-dialog[open]");
    let bridgeActive = true;
    let bridgeFailure = null;
    const bridgePump = (async () => {
      try {
        while (bridgeActive) {
          const queued = await managementPage.evaluate(() =>
            window.__androidPloverRequestQueue.splice(0),
          );
          if (queued.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            continue;
          }
          for (const { body, requestId } of queued) {
            const request = JSON.parse(body);
            const forwarded = {
              request,
              response: null,
              error: "",
              pending: true,
            };
            forwardedRequests.push(forwarded);
            // Keep the worker-backed runtime page active while Puppeteer
            // models Android attaching its independent runtime WebView.
            await page.bringToFront();
            const runtimeRequestId = nextRuntimeRequestId++;
            forwarded.runtimeRequestId = runtimeRequestId;
            const bridgeResult = await dispatchRuntimeBody(
              page,
              runtimeRequestId,
              body,
            );
            forwarded.response = bridgeResult.response
              ? JSON.parse(bridgeResult.response)
              : null;
            forwarded.error = bridgeResult.error;
            forwarded.pending = false;
            await managementPage.bringToFront();
            await managementPage.evaluate(
              ({ requestId, bridgeResult, method }) => {
                window.handleAndroidPloverResponse(
                  requestId,
                  bridgeResult.response,
                  bridgeResult.error,
                );
                window.__completedAndroidPloverMethods.push(method);
              },
              { requestId, bridgeResult, method: request.method },
            );
          }
        }
      } catch (error) {
        bridgeFailure = error;
        console.error("Android two-WebView bridge pump failed:", error);
      }
    })();
    try {
      await managementPage.waitForFunction(
        () =>
          window.__completedAndroidPloverMethods.includes(
            "get_dictionary_state",
          ),
        { timeout: 30_000 },
      );
    } catch (error) {
      const managementState = await managementPage.evaluate(() => ({
        dictionary: document.querySelector(".plover-dictionary-name")
          ?.textContent,
        message: document.querySelector("#plover-message")?.textContent,
      }));
      throw new Error(
        `Android dictionary manager did not become available: ${JSON.stringify({
          managementState,
          forwardedRequests,
          cause: error.message,
        })}`,
      );
    }
    await managementPage.click("#plover-panel-dictionaries summary");

    const uploadDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "v7-android-dictionary-upload-"),
    );
    const pythonEntries = [
      "    ('TEFT',): 'python-upload-works',",
      ...Array.from(
        { length: 900 },
        (_, index) =>
          `    ('T-${index}',): 'python-upload-regression-${index}',`,
      ),
    ];
    const pythonDictionary = `
LONGEST_KEY = 1

DICTIONARY = {
${pythonEntries.join("\n")}
}

def lookup(key):
    if key in DICTIONARY:
        return DICTIONARY[key]
    raise KeyError(key)
`;
    const pythonDictionaryBytes = Buffer.byteLength(pythonDictionary, "utf8");
    if (pythonDictionaryBytes < 40_000 || pythonDictionaryBytes > 60_000) {
      throw new Error(
        `Python upload regression fixture has unexpected size: ${pythonDictionaryBytes}`,
      );
    }
    try {
      try {
        await uploadDictionary(
          managementPage,
          uploadDirectory,
          "android-upload.py",
          pythonDictionary,
          "python",
        );
      } catch (error) {
        throw new Error(
          `${error.message}; bridge=${JSON.stringify({
            forwardedRequests,
            bridgeFailure: bridgeFailure?.message,
          })}`,
        );
      }
      await uploadDictionary(
        managementPage,
        uploadDirectory,
        "android-upload.json",
        `${JSON.stringify({ "SKWR-S": "json-upload-works" })}\n`,
        "json",
      );
    } finally {
      fs.rmSync(uploadDirectory, { recursive: true, force: true });
    }

    for (const [name, type] of [
      ["android-upload.py", "python"],
      ["android-upload.json", "json"],
    ]) {
      const forwarded = forwardedRequests.find(
        ({ request }) =>
          request.method === "import_dictionary" &&
          request.params?.name === name,
      );
      if (
        !forwarded ||
        forwarded.request.params.type !== type ||
        forwarded.error ||
        forwarded.response?.error ||
        forwarded.response?.result?.status !== "ok"
      ) {
        throw new Error(
          `Android ${type} upload did not cross both WebViews successfully: ${JSON.stringify(forwarded)}`,
        );
      }
    }
    const importDiagnostics = await page.evaluate(
      () => window.__runtimeDiagnostics,
    );
    const startupDiagnostics = importDiagnostics.filter(
      ({ requestId }) => requestId === 0,
    );
    const expectedIoMode = emulateNonIsolatedWebView
      ? "mode=service-worker"
      : "mode=atomics";
    if (
      !startupDiagnostics.some(
        ({ phase, detail }) =>
          phase === "runtime-io-ready" && detail.includes(expectedIoMode),
      )
    ) {
      throw new Error(
        `Runtime did not report ${expectedIoMode}: ${JSON.stringify(startupDiagnostics)}`,
      );
    }
    if (
      emulateNonIsolatedWebView &&
      ![
        "runtime-service-worker-register-start",
        "runtime-service-worker-activated",
      ].every((phase) =>
        startupDiagnostics.some((diagnostic) => diagnostic.phase === phase),
      )
    ) {
      throw new Error(
        `Runtime service-worker startup was not fully diagnosed: ${JSON.stringify(startupDiagnostics)}`,
      );
    }
    for (const forwarded of forwardedRequests.filter(
      ({ request }) => request.method === "import_dictionary",
    )) {
      for (const phase of ["runtime-start", "runtime-complete"]) {
        if (
          !importDiagnostics.some(
            (diagnostic) =>
              diagnostic.requestId === forwarded.runtimeRequestId &&
              diagnostic.phase === phase,
          )
        ) {
          throw new Error(
            `Android ${forwarded.request.params.type} upload did not report ${phase}: ${JSON.stringify(importDiagnostics)}`,
          );
        }
      }
    }
    const pythonImport = forwardedRequests.find(
      ({ request }) =>
        request.method === "import_dictionary" &&
        request.params?.type === "python",
    );
    const pythonDiagnostics = importDiagnostics.filter(
      ({ requestId }) => requestId === pythonImport?.runtimeRequestId,
    );
    for (const phase of [
      "python-dictionary-initialize-start",
      "python-kernel-create-start",
      "python-worker-environment",
      "python-worker-wasm-import-start",
      "python-worker-wasm-import-complete",
      "python-interpreter-init-complete",
      "python-source-exec-start",
      "python-source-exec-complete",
      "python-entry-enumeration-complete",
      "python-dictionary-initialize-complete",
    ]) {
      if (!pythonDiagnostics.some((diagnostic) => diagnostic.phase === phase)) {
        throw new Error(
          `Android Python upload did not report ${phase}: ${JSON.stringify(pythonDiagnostics)}`,
        );
      }
    }
    const uploadedTranslation = await requestRuntime(
      page,
      nextRuntimeRequestId++,
      "translate",
      { stroke: "TEFT" },
    );
    if (
      !Array.isArray(uploadedTranslation.output) ||
      !uploadedTranslation.output.some(
        (element) =>
          element.type === "preedit" && element.text === "python-upload-works",
      )
    ) {
      throw new Error(
        `Uploaded Android Python dictionary did not translate: ${JSON.stringify(uploadedTranslation)}`,
      );
    }
    bridgeActive = false;
    await bridgePump;
    if (bridgeFailure) {
      throw bridgeFailure;
    }
    await managementPage.close();

    const initializedSchema = await page.evaluate(() =>
      window.__sqliteExec.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS dictionaries"),
      ),
    );
    if (!initializedSchema) {
      throw new Error("Stripped Plover did not initialize its SQLite schema");
    }
    console.log(
      "Bundled Android Stripped Plover runtime and dictionary uploads passed",
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
