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
const pythonServiceWorkerAsset =
  "/assets/stripped-plover-python-service-worker.js";
const pythonServiceWorkerPrefix = "/assets/python-wasm-sw/";
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
  transformPythonDictionary(fs.readFileSync(stagedPythonDictionary, "utf8")),
);

const stagedEngine = path.join(stagedSource, "engine.ts");
fs.writeFileSync(
  stagedEngine,
  transformEngine(fs.readFileSync(stagedEngine, "utf8")),
);
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
  new Set(["node:crypto", "node:fs", "node:sqlite"]),
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
    path.join(adapterSource, "node-fs.ts"),
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
      "node:fs": [path.join(adapterSource, "node-fs.ts")],
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
    buildContext.onResolve({ filter: /^@stripped-plover\/stroke$/ }, () => ({
      path: path.join(upstream, "src", "stroke.ts"),
    }));
    buildContext.onResolve({ filter: /^node:sqlite$/ }, () => ({
      path: path.join(adapterSource, "node-sqlite.ts"),
    }));
    buildContext.onResolve({ filter: /^node:crypto$/ }, () => ({
      path: path.join(adapterSource, "node-crypto.ts"),
    }));
    buildContext.onResolve({ filter: /^node:fs$/ }, () => ({
      path: path.join(adapterSource, "node-fs.ts"),
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
        contents: transformPythonDictionary(
          await fs.promises.readFile(args.path, "utf8"),
        ),
        loader: "ts",
        resolveDir: path.dirname(args.path),
      }),
    );
    buildContext.onLoad(
      {
        filter: /system\/index\.ts$/,
      },
      async (args) => ({
        contents: transformSystemAssets(
          await fs.promises.readFile(args.path, "utf8"),
        ),
        loader: "ts",
        resolveDir: path.dirname(args.path),
      }),
    );
    buildContext.onLoad(
      {
        filter: /vendor\/@cowasm\/kernel\/dist\/wasm\/import-browser\.js$/,
      },
      async (args) => ({
        contents: transformKernelImportBrowser(
          await fs.promises.readFile(args.path, "utf8"),
        ),
        loader: "js",
        resolveDir: path.dirname(args.path),
      }),
    );
    buildContext.onLoad(
      {
        filter:
          /vendor\/@cowasm\/kernel\/dist\/wasm\/io-using-service-worker\.js$/,
      },
      async (args) => ({
        contents: transformMainServiceWorkerIO(
          await fs.promises.readFile(args.path, "utf8"),
        ),
        loader: "js",
        resolveDir: path.dirname(args.path),
      }),
    );
    buildContext.onLoad(
      {
        filter:
          /vendor\/@cowasm\/kernel\/dist\/wasm\/worker\/io-using-service-worker\.js$/,
      },
      async (args) => ({
        contents: replaceServiceWorkerPrefix(
          await fs.promises.readFile(args.path, "utf8"),
        ),
        loader: "js",
        resolveDir: path.dirname(args.path),
      }),
    );
    buildContext.onLoad(
      {
        filter:
          /vendor\/@cowasm\/kernel\/dist\/wasm\/worker\/service-worker\.js$/,
      },
      async (args) => ({
        contents: transformPythonServiceWorker(
          await fs.promises.readFile(args.path, "utf8"),
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

function transformPythonDictionary(source) {
  return assertTransforms(
    source.replace(
      "../../vendor/python-wasm/dist/node.js",
      "@v7/python-wasm-browser",
    ),
    ["@v7/python-wasm-browser"],
    "Python browser runtime import",
  );
}

function transformEngine(source) {
  const dispatchNeedle = `        case 'add_entry':
          result = this.addEntry(params);
          break;`;
  const dispatchReplacement = `${dispatchNeedle}
        case 'add_entry_safely':
          result = this.addEntrySafely(params);
          break;
        case 'replace_entry':
          result = this.replaceEntrySafely(params);
          break;`;
  const methodNeedle = `  private addEntry(params: Record<string, unknown>): Record<string, unknown> {`;
  const safeMethod = `  private addEntrySafely(params: Record<string, unknown>): Record<string, unknown> {
    const stroke = params.stroke as string;
    const translation = params.translation as string;
    const name = params.name as string | undefined;
    if (!stroke || !translation) {
      throw new Error('Both stroke and translation are required');
    }
    const strokeTuple = normalizeSteno(stroke, false);
    const selected = name ? this.dictionaries.get(name) : this.dictionaries.firstWithEntries();
    if (!selected) {
      throw new Error(\`Dictionary not found: \${name}\`);
    }
    if (!(selected instanceof StenoDictionary)) {
      throw new Error(\`Dictionary does not expose concrete entries: \${name}\`);
    }
    const existing = selected.get(strokeTuple);
    if (existing !== null) {
      return {
        status: 'conflict',
        conflict: true,
        stroke: strokeTuple.join('/'),
        existing_translation: existing,
      };
    }
    selected.set(strokeTuple, translation);
    return { status: 'ok', conflict: false, stroke: strokeTuple.join('/'), translation };
  }

  private replaceEntrySafely(params: Record<string, unknown>): Record<string, unknown> {
    const stroke = params.stroke as string;
    const translation = params.translation as string;
    const expected = params.expected_translation;
    const name = params.name as string | undefined;
    if (!stroke || !translation || typeof expected !== 'string') {
      throw new Error('Stroke, translation, and expected translation are required');
    }
    const strokeTuple = normalizeSteno(stroke, false);
    const selected = name ? this.dictionaries.get(name) : this.dictionaries.firstWithEntries();
    if (!selected) {
      throw new Error(\`Dictionary not found: \${name}\`);
    }
    if (!(selected instanceof StenoDictionary)) {
      throw new Error(\`Dictionary does not expose concrete entries: \${name}\`);
    }
    const existing = selected.get(strokeTuple);
    if (existing !== expected) {
      return { status: 'conflict', conflict: true, stroke: strokeTuple.join('/') };
    }
    selected.set(strokeTuple, translation);
    return { status: 'ok', conflict: false, stroke: strokeTuple.join('/'), translation };
  }

${methodNeedle}`;
  return assertTransforms(
    source
      .replace(dispatchNeedle, dispatchReplacement)
      .replace(methodNeedle, safeMethod),
    [
      "case 'add_entry_safely':",
      "private addEntrySafely(",
      "private replaceEntrySafely(",
    ],
    "atomic safe-add RPC",
  );
}

function transformSystemAssets(source) {
  return assertTransforms(
    source.replace(
      "new URL(`./assets/${filename}`, import.meta.url)",
      "new URL(`/assets/stripped-plover-assets/${filename}`, globalThis.location.href)",
    ),
    ["/assets/stripped-plover-assets/${filename}"],
    "system asset URL",
  );
}

function transformKernelImportBrowser(source) {
  return source.replaceAll("import.meta.url", "globalThis.location.href");
}

function transformMainServiceWorkerIO(source) {
  return assertTransforms(
    replaceServiceWorkerPrefix(source)
      .replaceAll("import.meta.url", "globalThis.location.href")
      .replace(
        '"./worker/service-worker.js"',
        JSON.stringify(pythonServiceWorkerAsset),
      ),
    [pythonServiceWorkerAsset, pythonServiceWorkerPrefix],
    "python service-worker URL",
  );
}

function replaceServiceWorkerPrefix(source) {
  return source.replaceAll("/python-wasm-sw/", pythonServiceWorkerPrefix);
}

function transformPythonServiceWorker(source) {
  return assertTransforms(
    replaceServiceWorkerPrefix(source)
      .replace(
        `self.addEventListener("install", (e) => {
    log("install  - python-wasm service worker, version: ", VERSION, e);
});`,
        `self.addEventListener("install", (e) => {
    log("install  - python-wasm service worker, version: ", VERSION, e);
    e.waitUntil(self.skipWaiting());
});`,
      )
      .replace(
        `self.addEventListener("activate", (e) => {
    log("activate - python-wasm service worker, version: ", VERSION, e);
});`,
        `self.addEventListener("activate", (e) => {
    log("activate - python-wasm service worker, version: ", VERSION, e);
    e.waitUntil(self.clients.claim());
});`,
      ),
    [pythonServiceWorkerPrefix, "self.skipWaiting()", "self.clients.claim()"],
    "python service-worker activation",
  );
}

function assertTransforms(source, markers, description) {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`Unable to apply ${description}: missing ${marker}`);
    }
  }
  return source;
}

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
  bundle: true,
  platform: "browser",
  target: ["chrome100"],
  entryPoints: {
    "stripped-plover-import-sandbox": path.join(
      adapterSource,
      "import-sandbox-entry.ts",
    ),
  },
  format: "iife",
  minify: true,
  outdir: output,
  plugins: [compatibilityPlugin],
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
    "stripped-plover-python-service-worker": path.join(
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

fs.cpSync(
  path.join(upstream, "src", "system", "assets"),
  path.join(output, "stripped-plover-assets"),
  { recursive: true, force: true },
);

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
