const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");

async function main() {
  const root = path.resolve(__dirname, "..");
  const binary =
    process.env.V7_INFERENCE_BINARY ||
    path.join(root, "inference-rs/target/debug/inference-rs");
  const model = process.env.V7_TEST_MODEL_PATH || path.join(root, "lm.binary");
  await fs.access(binary);
  await fs.access(model);
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(
    binary,
    [
      "--server",
      "--port",
      String(port),
      "--static-dir",
      path.join(root, "static"),
    ],
    {
      cwd: root,
      env: { ...process.env, V7_MODEL_PATH: model },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  let spawnError;
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null)
        throw new Error(`Inference exited: ${stderr}`);
      try {
        ready = (await fetch(`${base}/health`)).ok;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, `Inference did not become ready: ${stderr}`);
    assert.equal(await (await fetch(`${base}/health`)).text(), "ready");
    for (const route of [
      "/",
      "/index.html",
      "/ime.html",
      "/dictionary.html",
      "/script.js",
      "/plover/status",
      "/plover/ws",
    ]) {
      assert.equal(
        (await fetch(`${base}${route}`)).status,
        404,
        `${route} must not expose an editor or proxy`,
      );
    }
    const practice = await fs.readFile(
      path.join(root, "static/practice.html"),
      "utf8",
    );
    for (const route of ["/practice", "/practice/", "/practice.html"]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), practice);
    }
    for (const payload of [
      { islands: ["xin"] },
      { version: 2, islands: [{ kind: "fixed", text: "xin" }] },
    ]) {
      const response = await fetch(`${base}/infer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.candidates[0].join(""), "xin");
    }
    console.log(
      "Headless inference and retained practice routes passed; editor assets and Plover proxy are unavailable.",
    );
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
