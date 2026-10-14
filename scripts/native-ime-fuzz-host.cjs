const { buildSync } = require("esbuild");
const { runInNewContext } = require("node:vm");
const readline = require("node:readline");
const path = require("node:path");
const bundle = buildSync({
  entryPoints: [path.resolve(__dirname, "../src/ime-sandbox.ts")],
  bundle: true,
  write: false,
  platform: "neutral",
  format: "iife",
  target: "es2020",
}).outputFiles[0].text;
const sessions = new Map();
const telex = {};
runInNewContext(
  buildSync({
    entryPoints: [path.resolve(__dirname, "../src/telex-sandbox.ts")],
    bundle: true,
    write: false,
    platform: "neutral",
    format: "iife",
    target: "es2020",
  }).outputFiles[0].text,
  telex,
);
let tail = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  tail = tail.then(async () => {
    try {
      const call = JSON.parse(line);
      if (Object.hasOwn(call, "telex")) {
        process.stdout.write(
          JSON.stringify({ text: telex.convertV7TelexRaw(call.telex) }) + "\n",
        );
        return;
      }
      if (call.close) {
        sessions.delete(call.session);
        process.stdout.write("{}\n");
        return;
      }
      let protocol = sessions.get(call.session);
      if (!protocol) {
        const global = { console: { log() {}, error() {} } };
        runInNewContext(bundle, global);
        protocol = global.v7Input;
        sessions.set(call.session, protocol);
      }
      let timer;
      const task = call.command
        ? protocol.dispatch(call.command)
        : protocol.reply(call.id, call.value, call.error || "");
      const packet = await Promise.race([
        task,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Sandbox packet stalled for four seconds")),
            4000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      process.stdout.write(packet + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({ hostError: String(error) }) + "\n");
    }
  });
});
