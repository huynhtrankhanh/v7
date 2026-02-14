#!/usr/bin/env node
// Full-stack smoke test: Stripped Plover (real container) + inference backend + Puppeteer UI check.
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
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

async function ploverRpcOnPage(page, method, params) {
  return page.evaluate(
    async ({ method, params }) => {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("WS timeout")), 10000);
        const ws = new WebSocket(`ws://${location.host}/plover/ws`);
        ws.addEventListener("open", () => {
          ws.send(JSON.stringify({ id: 1, method, params }));
        });
        ws.addEventListener("message", (ev) => {
          try {
            const parsed = JSON.parse(ev.data);
            if (parsed.id !== 1) return;
            resolve(parsed);
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
    },
    { method, params }
  );
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
    const wsResult = await ploverRpcOnPage(page, "get_dictionary_state", {});
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

    const uniqueName = `puppeteer-${Date.now()}.json`;
    const renamedName = uniqueName.replace(".json", "-renamed.json");
    const stroke = "TEFT";

    const uploadPath = path.join("/tmp", uniqueName);
    fs.writeFileSync(uploadPath, "{}\n");
    const fileInput = await page.$("#plover-dict-file");
    if (!fileInput) {
      throw new Error("Dictionary file input not found");
    }
    await fileInput.uploadFile(uploadPath);
    await page.click("#plover-dict-name", { clickCount: 3 });
    await page.type("#plover-dict-name", uniqueName);
    await page.select("#plover-dict-type", "json");
    await page.click("#plover-dict-upload");

    await page.waitForFunction(
      (name) => Array.from(document.querySelectorAll(".plover-dictionary-name")).some((el) => el.textContent?.includes(name)),
      { timeout: 5000 },
      uniqueName
    );
    const stateAfterImport = await ploverRpcOnPage(page, "get_dictionary_state", {});
    const importedDictionary = (stateAfterImport?.result?.dictionaries || []).find((dict) =>
      [dict.identifier, dict.path, dict.name].some((value) => typeof value === "string" && value.includes(uniqueName))
    );
    if (!importedDictionary) {
      throw new Error(`Uploaded dictionary not found in state: ${JSON.stringify(stateAfterImport)}`);
    }
    const dictionaryId = importedDictionary.identifier || importedDictionary.path || importedDictionary.name;
    const importedLabel = await page.evaluate((name) => {
      const row = Array.from(document.querySelectorAll(".plover-dictionary-item")).find((entry) =>
        entry.querySelector(".plover-dictionary-name")?.textContent?.includes(name)
      );
      return row?.querySelector(".plover-dictionary-name")?.textContent?.trim() || "";
    }, uniqueName);
    if (importedLabel === "dictionary") {
      throw new Error(`Dictionary label incorrectly rendered: ${importedLabel}`);
    }

    await page.select("#plover-entry-dict", dictionaryId);
    await page.click("#plover-entry-stroke", { clickCount: 3 });
    await page.type("#plover-entry-stroke", stroke);
    await page.click("#plover-entry-translation", { clickCount: 3 });
    await page.type("#plover-entry-translation", "one");
    await page.click("#plover-entry-add");

    let exported = await ploverRpcOnPage(page, "export_dictionary", { name: uniqueName });
    if (exported?.result?.data?.[stroke] !== "one") {
      throw new Error(`Entry add failed: ${JSON.stringify(exported)}`);
    }

    await page.click("#plover-entry-translation", { clickCount: 3 });
    await page.type("#plover-entry-translation", "two");
    await page.select("#plover-entry-dict", dictionaryId);
    await page.click("#plover-entry-update");
    exported = await ploverRpcOnPage(page, "export_dictionary", { name: uniqueName });
    if (exported?.result?.data?.[stroke] !== "two") {
      throw new Error(`Entry update failed: ${JSON.stringify(exported)}`);
    }

    await page.select("#plover-entry-dict", dictionaryId);
    await page.click("#plover-entry-remove");
    exported = await ploverRpcOnPage(page, "export_dictionary", { name: uniqueName });
    if (Object.prototype.hasOwnProperty.call(exported?.result?.data || {}, stroke)) {
      throw new Error(`Entry remove failed: ${JSON.stringify(exported)}`);
    }

    await page.evaluate((name) => {
      window.prompt = () => name;
    }, renamedName);
    await page.evaluate((name) => {
      const rows = Array.from(document.querySelectorAll(".plover-dictionary-item"));
      const row = rows.find((entry) => entry.querySelector(".plover-dictionary-name")?.textContent?.trim() === name);
      if (!row) throw new Error(`Dictionary row not found: ${name}`);
      const renameButton = Array.from(row.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Rename");
      if (!renameButton) throw new Error("Rename button not found");
      renameButton.click();
    }, uniqueName);
    await page.waitForFunction(
      (name) => Array.from(document.querySelectorAll(".plover-dictionary-name")).some((el) => el.textContent?.trim() === name),
      { timeout: 5000 },
      renamedName
    );

    await page.evaluate(() => {
      window.confirm = () => true;
    });
    await page.evaluate((name) => {
      const rows = Array.from(document.querySelectorAll(".plover-dictionary-item"));
      const row = rows.find((entry) => entry.querySelector(".plover-dictionary-name")?.textContent?.trim() === name);
      if (!row) throw new Error(`Dictionary row not found: ${name}`);
      const deleteButton = Array.from(row.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Delete");
      if (!deleteButton) throw new Error("Delete button not found");
      deleteButton.click();
    }, renamedName);
    await page.waitForFunction(
      (name) => !Array.from(document.querySelectorAll(".plover-dictionary-name")).some((el) => el.textContent?.trim() === name),
      { timeout: 5000 },
      renamedName
    );

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
