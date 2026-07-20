import { Buffer as BrowserBuffer } from "buffer";
import browserProcess from "process";

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
