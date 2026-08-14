#!/usr/bin/env node
import { build } from "esbuild";
import path from "node:path";

const output = process.argv[2];
if (!output) throw new Error("usage: build-telex-sandbox.mjs OUTPUT");

await build({
  entryPoints: [path.resolve("src/telex-sandbox.ts")],
  outfile: path.resolve(output),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
});
