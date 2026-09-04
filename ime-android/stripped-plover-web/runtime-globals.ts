import { Buffer as BrowserBuffer } from "buffer";
import browserProcess from "process";

// These named exports let esbuild inject the browser implementations anywhere
// a bundled dependency uses Node's globals without importing them. This is
// especially important for the python-wasm worker, which has its own global
// scope and cannot inherit globals installed on the runtime page.
export { BrowserBuffer as Buffer, browserProcess as process };
export const global = globalThis;

export function installNodeGlobals(): void {
  const runtimeGlobal = globalThis as typeof globalThis & {
    Buffer?: typeof BrowserBuffer;
    global?: typeof globalThis;
    process?: typeof browserProcess;
  };
  runtimeGlobal.Buffer ??= BrowserBuffer;
  runtimeGlobal.global ??= runtimeGlobal;
  runtimeGlobal.process ??= browserProcess;
}
