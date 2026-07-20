#!/usr/bin/env node

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { build } from "esbuild";

const [upstreamArgument, sourceArgument, outputArgument, typecheckArgument] =
  process.argv.slice(2);
if (
  !upstreamArgument ||
  !sourceArgument ||
  !outputArgument ||
  !typecheckArgument
) {
  throw new Error(
    "usage: build-stripped-plover-web.mjs <upstream> <adapter-source> <output> <typecheck-work>",
  );
}

const upstream = path.resolve(upstreamArgument);
const adapterSource = path.resolve(sourceArgument);
const output = path.resolve(outputArgument);
const typecheckWork = path.resolve(typecheckArgument);
const stagedSource = path.join(typecheckWork, "src");
const upstreamEngine = path.join(upstream, "src", "engine.ts");
const require = createRequire(import.meta.url);
const browserCoreModules = new Map([
  ["assert", require.resolve("assert/")],
  ["buffer", require.resolve("buffer/")],
  ["events", require.resolve("events/")],
  ["path", require.resolve("path-browserify")],
  ["process", require.resolve("process/browser")],
  ["stream", require.resolve("stream-browserify")],
  ["util", require.resolve("util/")],
]);

fs.rmSync(output, { recursive: true, force: true });
fs.rmSync(typecheckWork, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(typecheckWork, { recursive: true });
fs.cpSync(path.join(upstream, "src"), stagedSource, {
  recursive: true,
  force: true,
  filter(source) {
    return !source.endsWith(".test.ts") && !source.includes(`${path.sep}e2e`);
  },
});

const stagedPythonDictionary = path.join(
  stagedSource,
  "dictionary",
  "python-dictionary.ts",
);
fs.writeFileSync(
  stagedPythonDictionary,
  fs
    .readFileSync(stagedPythonDictionary, "utf8")
    .replace(
      "../../vendor/python-wasm/dist/node.js",
      "@v7/python-wasm-browser",
    ),
);

const stagedEngine = path.join(stagedSource, "engine.ts");
const productionFiles = collectProductionGraph(stagedEngine);
const nodeApis = new Set();
const processProperties = new Set();
const bufferProperties = new Set();
for (const filename of productionFiles) {
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
  visit(source);
}

assertSet(
  nodeApis,
  new Set(["node:crypto", "node:sqlite"]),
  "production Node module imports",
);
assertSet(
  processProperties,
  new Set(["platform"]),
  "production process properties",
);
assertSet(bufferProperties, new Set(["alloc"]), "production Buffer properties");

const typeDeclarations = path.join(typecheckWork, "android-runtime.d.ts");
fs.writeFileSync(
  typeDeclarations,
  `
declare class Buffer extends Uint8Array {
  static alloc(size: number): Buffer;
  writeBigUInt64LE(value: bigint, offset?: number): number;
}
declare const process: { platform: string };
declare module "@v7/python-wasm-browser" {
  export interface PythonWasmAsync {
    exec(code: string): Promise<void>;
    repr(code: string): Promise<string>;
    terminate(): void;
  }
  export function asyncPython(options?: unknown): Promise<PythonWasmAsync>;
}
`,
);

const program = ts.createProgram({
  rootNames: [
    ...productionFiles,
    path.join(adapterSource, "node-sqlite.ts"),
    path.join(adapterSource, "node-crypto.ts"),
    typeDeclarations,
  ],
  options: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    baseUrl: typecheckWork,
    paths: {
      "node:sqlite": [path.join(adapterSource, "node-sqlite.ts")],
      "node:crypto": [path.join(adapterSource, "node-crypto.ts")],
    },
  },
});
const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (diagnostics.length > 0) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (filename) => filename,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }),
  );
}

const compatibilityPlugin = {
  name: "stripped-plover-android-compatibility",
  setup(buildContext) {
    buildContext.onResolve({ filter: /^@stripped-plover\/engine$/ }, () => ({
      path: upstreamEngine,
    }));
    buildContext.onResolve({ filter: /^node:sqlite$/ }, () => ({
      path: path.join(adapterSource, "node-sqlite.ts"),
    }));
    buildContext.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: path.join(adapterSource, "node-crypto.ts"),
    }));
    buildContext.onResolve(
      { filter: /^(assert|buffer|events|path|process|stream|util)$/ },
      (args) => ({ path: browserCoreModules.get(args.path) }),
    );
    buildContext.onResolve({ filter: /^@v7\/python-wasm-browser$/ }, () => ({
      path: "python-wasm-browser",
      namespace: "v7-compatibility",
    }));
    buildContext.onLoad(
      {
        filter: /python-dictionary\.ts$/,
      },
      async (args) => ({
        contents: (await fs.promises.readFile(args.path, "utf8")).replace(
          "../../vendor/python-wasm/dist/node.js",
          "@v7/python-wasm-browser",
        ),
        loader: "ts",
        resolveDir: path.dirname(args.path),
      }),
    );
    buildContext.onLoad(
      {
        filter:
          /vendor\/@cowasm\/kernel\/dist\/wasm\/(import-browser|io-using-service-worker)\.js$/,
      },
      async (args) => ({
        contents: (await fs.promises.readFile(args.path, "utf8")).replaceAll(
          "import.meta.url",
          "globalThis.location.href",
        ),
        loader: "js",
        resolveDir: path.dirname(args.path),
      }),
    );
    buildContext.onLoad(
      {
        filter: /^python-wasm-browser$/,
        namespace: "v7-compatibility",
      },
      () => ({
        contents: `
          import browserAsyncPython from ${JSON.stringify(
            path.join(upstream, "vendor", "python-wasm", "dist", "browser.js"),
          )};
          export const asyncPython = browserAsyncPython;
        `,
        loader: "js",
        resolveDir: upstream,
      }),
    );
  },
};

const sharedBuildOptions = {
  bundle: true,
  platform: "browser",
  target: ["chrome100"],
  tsconfigRaw: {
    compilerOptions: {},
  },
  sourcemap: false,
  minify: true,
  outdir: output,
  loader: {
    ".wasm": "file",
    ".zip": "file",
    ".xz": "file",
  },
  assetNames: "stripped-plover-assets/[name]-[hash]",
  publicPath: "/assets/",
  define: {
    __dirname: '"/"',
    __filename: '"/stripped-plover-runtime.js"',
    "process.env.NODE_ENV": '"production"',
  },
  inject: [path.join(adapterSource, "runtime-globals.ts")],
  plugins: [compatibilityPlugin],
};

await build({
  ...sharedBuildOptions,
  entryPoints: {
    "stripped-plover-runtime": path.join(adapterSource, "runtime-entry.ts"),
  },
  format: "iife",
});

await build({
  ...sharedBuildOptions,
  entryPoints: {
    "worker/browser": path.join(
      upstream,
      "vendor",
      "@cowasm",
      "kernel",
      "dist",
      "wasm",
      "worker",
      "browser.js",
    ),
    "worker/service-worker": path.join(
      upstream,
      "vendor",
      "@cowasm",
      "kernel",
      "dist",
      "wasm",
      "worker",
      "service-worker.js",
    ),
  },
  format: "iife",
});

fs.copyFileSync(
  path.join(adapterSource, "runtime.html"),
  path.join(output, "stripped-plover-runtime.html"),
);

function collectProductionGraph(entrypoint) {
  const result = [];
  const visited = new Set();
  const visitFile = (filename) => {
    const normalized = path.normalize(filename);
    if (visited.has(normalized)) return;
    visited.add(normalized);
    result.push(normalized);

    const source = ts.createSourceFile(
      normalized,
      fs.readFileSync(normalized, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    source.forEachChild((node) => {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      ) {
        return;
      }
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith(".")) return;
      const resolved = path
        .resolve(path.dirname(normalized), specifier)
        .replace(/\.js$/, ".ts");
      if (resolved.startsWith(stagedSource) && fs.existsSync(resolved)) {
        visitFile(resolved);
      }
    });
  };
  visitFile(entrypoint);
  return result;
}

function visit(node) {
  if (
    ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text.startsWith("node:")
  ) {
    nodeApis.add(node.moduleSpecifier.text);
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process"
  ) {
    processProperties.add(node.name.text);
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "Buffer"
  ) {
    bufferProperties.add(node.name.text);
  }
  ts.forEachChild(node, visit);
}

function assertSet(actual, expected, label) {
  const actualValues = [...actual].sort();
  const expectedValues = [...expected].sort();
  if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
    throw new Error(
      `${label} changed; expected ${expectedValues.join(", ") || "(none)"}, ` +
        `found ${actualValues.join(", ") || "(none)"}. Audit and extend the Android polyfills.`,
    );
  }
}
