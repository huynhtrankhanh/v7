#!/usr/bin/env node
// Full-stack smoke test: Stripped Plover (real container) + inference backend + Puppeteer UI check.
const { spawn } = require("child_process");
const path = require("path");
const puppeteer = require("puppeteer");
const net = require("net");

const ROOT = path.resolve(__dirname, "..");
const PLOVER_PORT = 4020;
const SERVER_PORT = 3000;
const PLOVER_RECOVERY_TIMEOUT_MS = 7000;
const INITIAL_STATE_TIMEOUT_MS = 1000;

function waitForOutput(proc, substring, logsRef) {
  return new Promise((resolve, reject) => {
    const onData = (data) => {
      const text = data.toString();
      if (logsRef) logsRef.buffer += text;
      if (text.includes(substring)) {
        proc.stdout.off("data", onData);
        proc.stderr.off("data", onData);
        resolve();
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => reject(new Error(`Process exited early: ${code}. Logs:\n${logsRef ? logsRef.buffer : ""}`)));
  });
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.connect(port, host, () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`));
        } else {
          setTimeout(tryConnect, 500);
        }
      });
    };
    tryConnect();
  });
}

async function main() {
  let serverProc;
  const screenshotPath = path.join("/tmp", "fullstack-e2e.png");
  try {
    await new Promise((resolve) => {
      const dcDown = spawn("docker", ["compose", "down", "stripped-plover"], { cwd: ROOT, stdio: "inherit" });
      dcDown.on("exit", () => resolve());
    });
    const serverLogs = { buffer: "" };
    serverProc = spawn(
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

    await waitForOutput(serverProc, "Listening on", serverLogs);

    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.goto(`http://localhost:${SERVER_PORT}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#plover-status");
    await page.waitForFunction(
      () => document.querySelector("#plover-status")?.textContent?.toLowerCase().includes("unavailable"),
      { timeout: 5000 }
    );
    await page.waitForFunction(() => document.querySelector("#plover-dictionary-open")?.disabled === true, { timeout: INITIAL_STATE_TIMEOUT_MS });

    const dcUp = spawn("docker", ["compose", "up", "-d", "stripped-plover"], { cwd: ROOT, stdio: "inherit" });
    await new Promise((resolve, reject) => dcUp.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`docker compose up exited ${code}`)))));
    await waitForPort(PLOVER_PORT, "127.0.0.1");

    await page.waitForFunction(
      () => document.querySelector("#plover-status")?.textContent?.toLowerCase().includes("available"),
      { timeout: PLOVER_RECOVERY_TIMEOUT_MS }
    );
    await page.waitForFunction(
      () => document.querySelector("#plover-dictionary-open")?.disabled === false,
      { timeout: PLOVER_RECOVERY_TIMEOUT_MS }
    );

    // Exercise WS endpoint directly.
    const wsResult = await page.evaluate(async () => {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WS timeout")), 10000);
        const ws = new WebSocket(`ws://${location.host}/plover/ws`);
        ws.addEventListener("open", () => {
          ws.send(JSON.stringify({ id: 1, method: "get_dictionary_state", params: {} }));
        });
        ws.addEventListener("message", (ev) => {
          try {
            resolve(JSON.parse(ev.data));
          } catch (e) {
            reject(e);
          } finally {
            clearTimeout(timer);
            ws.close();
          }
        });
        ws.addEventListener("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
    });
    if (!wsResult?.ok) {
      throw new Error(`WebSocket RPC failed (not ok): ${JSON.stringify(wsResult)}`);
    }
    if (!wsResult?.result?.dictionaries) {
      throw new Error(`WebSocket RPC missing dictionaries: ${JSON.stringify(wsResult)}`);
    }

    // Toggle plover mode via UI.
    await page.click("#plover-toggle");
    await page.waitForFunction(
      () => document.querySelector("#plover-status")?.textContent?.toLowerCase().includes("enabled"),
      { timeout: 3000 }
    );

    await page.click("#plover-dictionary-open");
    await page.waitForSelector("#plover-dictionary-dialog[open]");
    // Ensure dictionary input accepts text while capture is paused.
    await page.click("#plover-entry-stroke");
    await page.type("#plover-entry-stroke", "PUPE2E");
    const strokeVal = await page.$eval("#plover-entry-stroke", (el) => el.value);
    if (strokeVal !== "PUPE2E") {
      throw new Error(`Dictionary stroke input did not capture text, got: ${strokeVal}`);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });

    await browser.close();
  } finally {
    if (serverProc) {
      serverProc.kill("SIGINT");
    }
    spawn("docker", ["compose", "down", "stripped-plover"], { cwd: ROOT, stdio: "inherit" });
  }
  console.log(`Full-stack e2e completed. Screenshot: ${screenshotPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
