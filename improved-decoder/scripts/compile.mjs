import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const limit = 50 * 1024;
const targets = ["baseline", "decoder"];

await mkdir(resolve(root, "dist"), { recursive: true });

for (const target of targets) {
  const outfile = resolve(root, "dist", `${target}.cjs`);
  await build({
    entryPoints: [resolve(root, "src", `${target}.js`)],
    outfile,
    bundle: true,
    minify: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    legalComments: "none",
  });

  const bytes = (await stat(outfile)).size;
  if (bytes > limit) {
    throw new Error(`${target}.cjs is ${bytes} bytes; limit is ${limit}.`);
  }

  // Reading the artifact catches accidental empty output before reporting it.
  if ((await readFile(outfile, "utf8")).trim().length === 0) {
    throw new Error(`${target}.cjs is empty.`);
  }
  console.log(`${target}.cjs: ${bytes} / ${limit} bytes`);
}
