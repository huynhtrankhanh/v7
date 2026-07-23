import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = resolve(root, ".cache");
const outfile = resolve(cache, "host.cjs");
await mkdir(cache, { recursive: true });

await build({
  entryPoints: [resolve(root, "host", "main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  legalComments: "none",
  sourcemap: "inline",
});

const child = spawn(process.execPath, [outfile, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});
