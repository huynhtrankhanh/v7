import { Buffer } from "buffer";
import browserProcess from "process";

// These named exports let esbuild inject the browser implementations anywhere
// a bundled dependency uses Node's globals without importing them. This is
// especially important for the python-wasm worker, which has its own global
// scope and cannot inherit globals installed on the runtime page.
export { Buffer } from "buffer";
export { browserProcess as process };
export const global = globalThis;

export function installNodeGlobals(): void {
  const runtimeGlobal = globalThis as typeof globalThis & {
    Buffer?: typeof Buffer;
    global?: typeof globalThis;
    process?: typeof browserProcess;
  };
  runtimeGlobal.Buffer ??= Buffer;
  runtimeGlobal.global ??= runtimeGlobal;
  runtimeGlobal.process ??= browserProcess;
}
