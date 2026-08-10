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
    throw new Error(`runtime request ${requestId} timed out: ${error.message}`);
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
  await page.waitForFunction(
    (expectedName) => {
      const status = document.querySelector("#plover-import-status");
      return (
        status?.textContent?.includes(expectedName) &&
        (status.classList.contains("succeeded") ||
          status.classList.contains("failed"))
      );
    },
    { timeout: 120_000 },
    filename,
  );
  const backgroundFailure = await page.$eval(
    "#plover-import-status",
    (element) =>
      element.classList.contains("failed") ? element.textContent : "",
  );
  if (backgroundFailure) {
    throw new Error(backgroundFailure);
  }
  const progress = await page.$eval("#plover-import-progress", (element) =>
    Number(element.value),
  );
  if (progress !== 100) {
    throw new Error(
      `Android import progress did not finish at 100%: ${progress}`,
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
      window.__runtimeEvents = [];
      window.__sqliteExec = [];
      window.__sqliteEntries = [];
      window.AndroidStrippedPloverRuntime = {
        onReady() {
          window.__runtimeReady = true;
        },
        onResponse(requestId, response, error) {
          window.__runtimeResults.push({ requestId, response, error });
        },
        onEvent(event) {
          window.__runtimeEvents.push(JSON.parse(event));
        },
      };
      window.AndroidStrippedPloverSqlite = {
        open() {},
        exec(sql) {
          window.__sqliteExec.push(sql);
        },
        query(sql, parametersJson = "[]") {
          const parameters = JSON.parse(parametersJson);
          if (
            /SELECT COUNT\(\*\) AS count FROM entries WHERE dictionary = \?/i.test(
              sql,
            )
          ) {
            return JSON.stringify([
              {
                count: window.__sqliteEntries.filter(
                  (entry) => entry.dictionary === parameters[0],
                ).length,
              },
            ]);
          }
          if (
            /SELECT translation FROM entries WHERE stroke = \? AND dictionary = \?/i.test(
              sql,
            )
          ) {
            const entry = window.__sqliteEntries.find(
              (candidate) =>
                candidate.stroke === parameters[0] &&
                candidate.dictionary === parameters[1],
            );
            return JSON.stringify(
              entry ? [{ translation: entry.translation }] : [],
            );
          }
          if (/COUNT\(\*\)/i.test(sql)) {
            return JSON.stringify([{ count: window.__sqliteEntries.length }]);
          }
          if (/SELECT MAX\(/i.test(sql)) {
            return JSON.stringify([{ maxLen: null }]);
          }
          return "[]";
        },
        run(sql, parametersJson = "[]") {
          const parameters = JSON.parse(parametersJson);
          if (/INSERT OR REPLACE INTO entries/i.test(sql)) {
            const [dictionary, stroke, translation] = parameters;
            window.__sqliteEntries = window.__sqliteEntries.filter(
              (entry) =>
                entry.dictionary !== dictionary || entry.stroke !== stroke,
            );
            window.__sqliteEntries.push({
              dictionary,
              stroke,
              translation,
            });
          } else if (/DELETE FROM entries WHERE dictionary = \?/i.test(sql)) {
            window.__sqliteEntries = window.__sqliteEntries.filter(
              (entry) => entry.dictionary !== parameters[0],
            );
          }
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
    const eventImport = await requestRuntime(page, 8, "import_dictionary", {
      name: "host-events.json",
      type: "json",
      data: { TEFT: "{PLOVER:LOOKUP:test}" },
      merge: false,
    });
    const addConflict = await requestRuntime(page, 12, "add_entry_safely", {
      name: "host-events.json",
      stroke: "TEFT",
      translation: "must-not-overwrite",
    });
    if (
      addConflict.conflict !== true ||
      addConflict.existing_translation !== "{PLOVER:LOOKUP:test}"
    ) {
      throw new Error(
        `safe add did not preserve the existing entry: ${JSON.stringify(addConflict)}`,
      );
    }
    const safeAdd = await requestRuntime(page, 13, "add_entry_safely", {
      name: "host-events.json",
      stroke: "T*",
      translation: "first",
    });
    if (safeAdd.conflict !== false) {
      throw new Error(
        `safe add unexpectedly conflicted: ${JSON.stringify(safeAdd)}`,
      );
    }
    const replacement = await requestRuntime(page, 14, "replace_entry", {
      name: "host-events.json",
      stroke: "T*",
      translation: "second",
      expected_translation: "first",
    });
    if (replacement.conflict !== false) {
      throw new Error(
        `safe replacement failed: ${JSON.stringify(replacement)}`,
      );
    }
    const staleReplacement = await requestRuntime(page, 15, "replace_entry", {
      name: "host-events.json",
      stroke: "T*",
      translation: "stale-overwrite",
      expected_translation: "first",
    });
    const replacementLookup = await requestRuntime(page, 16, "lookup", {
      stroke: "T*",
    });
    if (
      staleReplacement.conflict !== true ||
      replacementLookup.translation !== "second"
    ) {
      throw new Error(
        `stale replacement overwrote the newer value: ${JSON.stringify({ staleReplacement, replacementLookup })}`,
      );
    }
    const eventTranslation = await requestRuntime(page, 9, "translate", {
      stroke: "TEFT",
    });
    const lookupEvent = await page.evaluate(() =>
      window.__runtimeEvents.find(
        (event) =>
          event.event === "plover:lookup" &&
          event.command === "lookup" &&
          event.argument === "test",
      ),
    );
    if (!lookupEvent) {
      const runtimeEvents = await page.evaluate(() => window.__runtimeEvents);
      throw new Error(
        `Bundled runtime did not forward the upstream Plover command event: ${JSON.stringify({ eventImport, eventTranslation, runtimeEvents })}`,
      );
    }
    await requestRuntime(page, 10, "remove_dictionary", {
      name: "host-events.json",
    });
    await requestRuntime(page, 11, "reset_state");

    // Exercise the same consumeNamedData contract used by AndroidX
    // JavaScriptSandbox. This is intentionally a separate, DOM-free import
    // bundle rather than the WebView engine runtime.
    const sandboxPage = await browser.newPage();
    await sandboxPage.evaluate(() => {
      window.__sandboxNamedData = new Map();
      window.android = {
        async consumeNamedDataAsArrayBuffer(name) {
          const value = window.__sandboxNamedData.get(name);
          if (!value) throw new Error(`Missing named data: ${name}`);
          window.__sandboxNamedData.delete(name);
          return value;
        },
      };
    });
    await sandboxPage.addScriptTag({
      content: fs.readFileSync(
        path.join(assetRoots[0], "stripped-plover-import-sandbox.js"),
        "utf8",
      ),
    });
    const sandboxJson = await sandboxPage.evaluate(async () => {
      const source = new TextEncoder().encode(
        JSON.stringify({ TEFT: "sandbox-json 한국어", "S/T": "two strokes" }),
      );
      window.__sandboxNamedData.set("json-source", source.buffer);
      const metadata = JSON.parse(
        await window.V7DictionaryImportSandbox.initialize(
          "json-source",
          "json",
        ),
      );
      const chunk = JSON.parse(window.V7DictionaryImportSandbox.nextChunk(200));
      return { metadata, chunk };
    });
    if (
      sandboxJson.metadata.total !== 2 ||
      !sandboxJson.chunk.done ||
      sandboxJson.chunk.processed !== 2 ||
      !sandboxJson.chunk.entries.some(
        ([stroke, translation]) =>
          stroke === "TEFT" && translation === "sandbox-json 한국어",
      )
    ) {
      throw new Error(
        `sandbox import planner did not parse/normalize JSON: ${JSON.stringify(sandboxJson)}`,
      );
    }
    const rejectsMalformedUtf8 = await sandboxPage.evaluate(async () => {
      window.__sandboxNamedData.set(
        "invalid-source",
        new Uint8Array([0xc0, 0xaf]).buffer,
      );
      try {
        await window.V7DictionaryImportSandbox.initialize(
          "invalid-source",
          "json",
        );
        return false;
      } catch (error) {
        return String(error).includes("not valid UTF-8");
      }
    });
    if (!rejectsMalformedUtf8) {
      throw new Error("sandbox import planner accepted malformed UTF-8");
    }
    const sandboxPython = await sandboxPage.evaluate(async () => {
      const source = new TextEncoder().encode(
        "LONGEST_KEY = 1\ndef lookup(key):\n    raise KeyError(key)\n",
      );
      window.__sandboxNamedData.set("python-source", source.buffer);
      return JSON.parse(
        await window.V7DictionaryImportSandbox.initialize(
          "python-source",
          "python",
        ),
      );
    });
    if (sandboxPython.type !== "python" || sandboxPython.total !== -1) {
      throw new Error(
        `sandbox import planner did not accept Python source: ${JSON.stringify(sandboxPython)}`,
      );
    }
    await sandboxPage.close();

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
      window.__dictionaryImportStates = {};
      window.__latestDictionaryImport = "";
      window.__backgroundRequestId = 10_000;
      window.__selectedImportCalls = 0;
      window.AndroidDictionary = {
        hasPloverConfiguration() {
          return true;
        },
        requestPlover(body, requestId) {
          window.__androidPloverRequestQueue.push({ body, requestId });
        },
        enqueueDictionaryImport(name, type, source, merge) {
          const id = `background-${window.__backgroundRequestId++}`;
          window.__latestDictionaryImport = id;
          window.__dictionaryImportStates[id] = {
            id,
            name,
            status: "queued",
            message: "Waiting to start",
            phase: "Queued",
            current: 0,
            total: -1,
            percent: 0,
          };
          window.__androidPloverRequestQueue.push({
            body: JSON.stringify({
              id,
              method: "import_dictionary_source",
              params: { name, type, source, merge },
            }),
            requestId: window.__backgroundRequestId++,
            backgroundTaskId: id,
          });
          return JSON.stringify({ id, error: "" });
        },
        enqueueSelectedDictionaryImport(name, type, merge) {
          window.__selectedImportCalls += 1;
          const file = document.querySelector("#plover-dict-file")?.files?.[0];
          if (!file) {
            return JSON.stringify({ id: "", error: "No selected file" });
          }
          const id = `background-${window.__backgroundRequestId++}`;
          window.__latestDictionaryImport = id;
          window.__dictionaryImportStates[id] = {
            id,
            name,
            status: "queued",
            message: "Waiting to start",
            phase: "Queued",
            current: 0,
            total: -1,
            percent: 0,
          };
          const reader = new FileReader();
          reader.addEventListener("load", () => {
            window.__androidPloverRequestQueue.push({
              body: JSON.stringify({
                id,
                method: "import_dictionary_source",
                params: {
                  name,
                  type,
                  source: String(reader.result ?? ""),
                  merge,
                },
              }),
              requestId: window.__backgroundRequestId++,
              backgroundTaskId: id,
            });
          });
          reader.readAsText(file);
          return JSON.stringify({ id, error: "" });
        },
        getDictionaryImportState(taskId) {
          const id = taskId || window.__latestDictionaryImport;
          return id && window.__dictionaryImportStates[id]
            ? JSON.stringify(window.__dictionaryImportStates[id])
            : "";
        },
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
          for (const { body, requestId, backgroundTaskId } of queued) {
            const request = JSON.parse(body);
            if (backgroundTaskId) {
              await managementPage.evaluate((taskId) => {
                window.__dictionaryImportStates[taskId].status = "running";
                window.__dictionaryImportStates[taskId].message =
                  "Loading in the Stripped Plover sandbox";
                window.__dictionaryImportStates[taskId].phase =
                  "Starting Android JavaScript sandbox";
                window.__dictionaryImportStates[taskId].percent = 18;
              }, backgroundTaskId);
            }
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
              ({ requestId, bridgeResult, method, backgroundTaskId }) => {
                if (backgroundTaskId) {
                  const response = bridgeResult.response
                    ? JSON.parse(bridgeResult.response)
                    : null;
                  const failed = bridgeResult.error || response?.error;
                  window.__dictionaryImportStates[backgroundTaskId] = {
                    ...window.__dictionaryImportStates[backgroundTaskId],
                    status: failed ? "failed" : "succeeded",
                    message: failed
                      ? bridgeResult.error || response.error.message
                      : `Imported ${response?.result?.entries ?? 0} entries`,
                    phase: failed ? "Failed" : "Complete",
                    current: response?.result?.entries ?? 0,
                    total: response?.result?.entries ?? 0,
                    percent: failed ? 18 : 100,
                  };
                } else {
                  window.handleAndroidPloverResponse(
                    requestId,
                    bridgeResult.response,
                    bridgeResult.error,
                  );
                }
                window.__completedAndroidPloverMethods.push(method);
              },
              {
                requestId,
                bridgeResult,
                method: request.method,
                backgroundTaskId,
              },
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
          request.method === "import_dictionary_source" &&
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
    const selectedImportCalls = await managementPage.evaluate(
      () => window.__selectedImportCalls,
    );
    if (selectedImportCalls !== 2) {
      throw new Error(
        `Android uploads crossed the JavaScript bridge as source strings: ${selectedImportCalls}`,
      );
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
