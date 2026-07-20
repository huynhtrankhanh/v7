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
        contents: transformPythonDictionary(
          await fs.promises.readFile(args.path, "utf8"),
        ),
        loader: "ts",
        resolveDir: path.dirname(args.path),
      }),
    );
    buildContext.onLoad(
      {
        filter: /vendor\/python-wasm\/dist\/browser\.js$/,
      },
      async (args) => ({
        contents: transformPythonWasmBrowser(
          await fs.promises.readFile(args.path, "utf8"),
        ),
        loader: "js",
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
        filter: /vendor\/@cowasm\/kernel\/dist\/wasm\/worker\/browser\.js$/,
      },
      async (args) => ({
        contents: transformKernelWorkerBrowser(
          await fs.promises.readFile(args.path, "utf8"),
        ),
        loader: "js",
        resolveDir: path.dirname(args.path),
      }),
    );
    buildContext.onLoad(
      {
        filter: /vendor\/@cowasm\/kernel\/dist\/wasm\/worker\/init\.js$/,
      },
      async (args) => ({
        contents: transformKernelWorkerInit(
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
    source
      .replace(
        "../../vendor/python-wasm/dist/node.js",
        "@v7/python-wasm-browser",
      )
      .replace(
        "  private async initializePython(pythonCode: string): Promise<void> {\n    // Use python-wasm",
        `  private async initializePython(pythonCode: string): Promise<void> {
    const report = (phase: string, detail = '') => {
      const callback = (globalThis as any).__v7PloverDiagnostic;
      if (typeof callback === 'function') callback(phase, detail);
    };
    report('python-dictionary-initialize-start', \`bytes=\${pythonCode.length}\`);
    // Use python-wasm`,
      )
      .replace(
        `    const py: PythonRuntime = await asyncPython({
      fs: 'everything',
    });`,
        `    report('python-wasm-create-start');
    const py: PythonRuntime = await asyncPython({
      fs: 'everything',
    });
    report('python-wasm-create-complete');`,
      )
      .replace(
        "    // Execute the Python code directly\n    await py.exec(pythonCode);",
        `    // Execute the Python code directly
    report('python-source-exec-start');
    await py.exec(pythonCode);
    report('python-source-exec-complete');`,
      )
      .replace(
        "    // Add safe lookup helper function\n    await py.exec(`",
        `    // Add safe lookup helper function
    report('python-helper-install-start');
    await py.exec(\``,
      )
      .replace(
        "`);\n\n    // Validate LONGEST_KEY exists and is valid",
        `\`);
    report('python-helper-install-complete');

    // Validate LONGEST_KEY exists and is valid
    report('python-metadata-validation-start');`,
      )
      .replace(
        "    const hasDict = await py.repr(\"'DICTIONARY' in dir()\");",
        `    report('python-metadata-validation-complete');
    const hasDict = await py.repr("'DICTIONARY' in dir()");`,
      )
      .replace(
        "    if (hasDict.trim() === 'True') {\n      try {",
        `    if (hasDict.trim() === 'True') {
      try {
        report('python-entry-enumeration-start');`,
      )
      .replace(
        "          this._length = this._entries.length;",
        `          this._length = this._entries.length;
          report('python-entry-enumeration-complete', \`entries=\${this._length}\`);`,
      )
      .replace(
        "    // Keep the Python runtime alive for lookups\n    this._py = py;",
        `    // Keep the Python runtime alive for lookups
    this._py = py;
    report(
      'python-dictionary-initialize-complete',
      \`entries=\${this._length} longestKey=\${this._longestKey}\`,
    );`,
      )
      .replace(
        "    try {\n      // Build Python tuple from stroke array",
        `    try {
      const diagnostic = (globalThis as any).__v7PloverDiagnostic;
      if (typeof diagnostic === 'function') {
        diagnostic('python-lookup-start', \`strokes=\${strokeTuple.length}\`);
      }
      // Build Python tuple from stroke array`,
      )
      .replace(
        "      const result = await this._py.repr(`__safe_lookup(${tupleStr})`);",
        `      const result = await this._py.repr(\`__safe_lookup(\${tupleStr})\`);
      if (typeof diagnostic === 'function') {
        diagnostic('python-lookup-complete');
      }`,
      ),
    [
      "python-dictionary-initialize-start",
      "python-wasm-create-complete",
      "python-source-exec-complete",
      "python-entry-enumeration-start",
      "python-dictionary-initialize-complete",
      "python-lookup-complete",
    ],
    "Python dictionary diagnostics",
  );
}

function transformPythonWasmBrowser(source) {
  return assertTransforms(
    source
      .replace(
        'const log = (0, debug_1.default)("python-wasm");',
        `const log = (0, debug_1.default)("python-wasm");
const report = (phase, detail = "") => {
    const callback = globalThis.__v7PloverDiagnostic;
    if (typeof callback === "function") callback(phase, detail);
};`,
      )
      .replace(
        '    log("creating async CoWasm kernel...");',
        `    report("python-kernel-create-start");
    log("creating async CoWasm kernel...");`,
      )
      .replace(
        '    log("done");\n    log("fetching ", PYTHONEXECUTABLE);',
        `    log("done");
    report("python-kernel-create-complete");
    report("python-assets-load-start");
    log("fetching ", PYTHONEXECUTABLE);`,
      )
      .replace(
        '    ]);\n    log("initializing python");',
        `    ]);
    report("python-assets-load-complete");
    report("python-interpreter-init-start");
    log("initializing python");`,
      )
      .replace(
        '    log("done");\n    return python;',
        `    log("done");
    report("python-interpreter-init-complete");
    return python;`,
      ),
    [
      "python-kernel-create-start",
      "python-assets-load-complete",
      "python-interpreter-init-complete",
    ],
    "python-wasm diagnostics",
  );
}

function transformKernelImportBrowser(source) {
  return assertTransforms(
    source.replaceAll("import.meta.url", "globalThis.location.href").replace(
      '            if (message?.event == "service-worker-broken") {',
      `            if (message?.event == "diagnostic") {
                const callback = globalThis.__v7PloverDiagnostic;
                if (typeof callback === "function") {
                    callback(message.phase, message.detail ?? "");
                }
                return;
            }
            if (message?.event == "service-worker-broken") {`,
    ),
    ['message?.event == "diagnostic"', "__v7PloverDiagnostic"],
    "kernel main-thread diagnostics",
  );
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

function transformKernelWorkerBrowser(source) {
  return assertTransforms(
    source
      .replace(
        'const log = (0, debug_1.default)("wasm:worker:browser");',
        `const log = (0, debug_1.default)("wasm:worker:browser");
const report = (phase, detail = "") => {
    self.postMessage({ event: "diagnostic", phase, detail });
};`,
      )
      .replace(
        '    log("wasmImportBrowser");',
        `    report("python-worker-filesystem-start", \`entries=\${options.fs?.length ?? 0}\`);
    log("wasmImportBrowser");`,
      )
      .replace(
        "    const fs = (0, wasi_js_1.createFileSystem)(fsSpec);",
        `    const fs = (0, wasi_js_1.createFileSystem)(fsSpec);
    report("python-worker-filesystem-ready", \`entries=\${fsSpec.length}\`);`,
      )
      .replace(
        "    const wasm = await (0, import_1.default)({",
        `    report("python-worker-wasm-import-start");
    const wasm = await (0, import_1.default)({`,
      )
      .replace(
        "    return wasm;\n}",
        `    report("python-worker-wasm-import-complete");
    return wasm;
}`,
      )
      .replace(
        '    log("initializing worker");',
        `    report(
        "python-worker-environment",
        \`crossOriginIsolated=\${crossOriginIsolated} io=\${crossOriginIsolated ? "atomics" : "service-worker"}\`,
    );
    log("initializing worker");`,
      ),
    [
      "python-worker-environment",
      "python-worker-filesystem-ready",
      "python-worker-wasm-import-complete",
    ],
    "kernel worker diagnostics",
  );
}

function transformKernelWorkerInit(source) {
  return assertTransforms(
    source
      .replace(
        "                const ioHandler = new IOHandler(message.options, () => {",
        `                parent.postMessage({
                    event: "diagnostic",
                    phase: "python-worker-init-start",
                    detail: "",
                });
                const ioHandler = new IOHandler(message.options, () => {`,
      )
      .replace(
        "                wasm = await wasmImport(message.name, opts);",
        `                wasm = await wasmImport(message.name, opts);
                parent.postMessage({
                    event: "diagnostic",
                    phase: "python-worker-init-complete",
                    detail: "",
                });`,
      ),
    ["python-worker-init-start", "python-worker-init-complete"],
    "kernel worker initialization diagnostics",
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
