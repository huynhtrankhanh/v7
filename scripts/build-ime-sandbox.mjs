#!/usr/bin/env node
import { build } from "esbuild";
import path from "node:path";
const output = process.argv[2];
if (!output) throw new Error("usage: build-ime-sandbox.mjs OUTPUT");
await build({
  entryPoints: [path.resolve("src/ime-sandbox.ts")],
  outfile: path.resolve(output),
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: "es2020",
  minify: true,
});
