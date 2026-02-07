#!/usr/bin/env node
// Full-stack smoke test: mock Stripped Plover TCP server + inference backend + Puppeteer UI check.
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const PLOVER_PORT = 4020;
const SERVER_PORT = 3000;

function startMockPlover(port = PLOVER_PORT) {
  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (data) => {
      buf += data.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const { id, method } = msg || {};
        let result = {};
        if (method === "translate") {
          result = { output: [{ type: "committed", text: "xin chao" }] };
        } else if (method === "get_dictionary_state") {
          result = { dictionaries: [] };
        } else if (method === "reset_state" || method === "get_starting_stroke_state") {
          result = {};
        }
        socket.write(JSON.stringify({ id, result }) + "\n");
      }
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

function waitForOutput(proc, substring) {
  return new Promise((resolve, reject) => {
    const onData = (data) => {
      const text = data.toString();
      if (text.includes(substring)) {
        proc.stdout.off("data", onData);
        resolve();
      }
    };
    proc.stdout.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`Process exited early: ${code}`)));
  });
}

async function main() {
  const mockPlover = await startMockPlover();

  const serverProc = spawn(
    "cargo",
    [
      "run",
      "--features",
      "mocked-model",
      "--manifest-path",
      path.join(ROOT, "inference-rs", "Cargo.toml"),
      "--",
      "--server",
      "--static-dir",
      path.join(ROOT, "static"),
      "--port",
      String(SERVER_PORT),
      "--stripped-plover-host",
      "127.0.0.1",
      "--stripped-plover-port",
      String(PLOVER_PORT),
    ],
    { cwd: ROOT, env: { ...process.env, RUST_LOG: "warn" }, stdio: ["ignore", "pipe", "pipe"] }
  );

  await waitForOutput(serverProc, "Listening on");

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${SERVER_PORT}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#plover-status");
  await page.waitForFunction(
    () => document.querySelector("#plover-status")?.textContent?.toLowerCase().includes("available"),
    { timeout: 5000 }
  );

  // Exercise WS endpoint directly.
  const wsResult = await page.evaluate(async () => {
    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${location.host}/plover/ws`);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ id: 1, method: "translate", params: { stroke: "TEFT" } }));
      });
      ws.addEventListener("message", (ev) => {
        try {
          resolve(JSON.parse(ev.data));
        } catch (e) {
          reject(e);
        } finally {
          ws.close();
        }
      });
      ws.addEventListener("error", reject);
    });
  });
  if (!wsResult?.ok && !wsResult?.result) {
    throw new Error("WebSocket translate failed");
  }

  // Toggle plover mode via UI.
  await page.click("#plover-toggle");
  await page.waitForFunction(
    () => document.querySelector("#plover-status")?.textContent?.toLowerCase().includes("enabled"),
    { timeout: 3000 }
  );

  // Ensure dictionary input accepts text while capture is paused.
  await page.click("#plover-entry-stroke");
  await page.type("#plover-entry-stroke", "PUPE2E");
  const strokeVal = await page.$eval("#plover-entry-stroke", (el) => el.value);
  if (strokeVal !== "PUPE2E") {
    throw new Error("Dictionary stroke input did not capture text");
  }

  const screenshotPath = path.join("/tmp", "fullstack-e2e.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await browser.close();
  serverProc.kill("SIGINT");
  mockPlover.close();
  console.log(`Full-stack e2e completed. Screenshot: ${screenshotPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
