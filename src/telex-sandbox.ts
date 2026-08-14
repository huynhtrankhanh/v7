import { convertTelex } from "./telex";

declare global {
  // JavaScriptSandbox evaluates each expression in this shared isolate global.
  // eslint-disable-next-line no-var
  var convertV7TelexRaw: (raw: string) => string;
}

globalThis.convertV7TelexRaw = (raw: string) =>
  convertTelex(raw, { freeShapeMarks: true });
