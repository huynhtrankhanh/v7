import path from "path";
import { TextDecoder, TextEncoder } from "util";
import { setUiCoreProvider } from "../src/uiCoreProvider";
import {
  createUiCoreProviderFromWasm,
  type UiCoreWasmExports
} from "../src/uiCoreWasmAdapter";

const loadGeneratedWasm = eval("require") as (modulePath: string) => UiCoreWasmExports;

beforeAll(() => {
  Object.assign(globalThis, { TextDecoder, TextEncoder });

  const generatedPath = path.resolve(__dirname, "../src/generated/v7_ui_core_node/v7_ui_core.js");
  const wasm = loadGeneratedWasm(generatedPath);
  setUiCoreProvider(createUiCoreProviderFromWasm(wasm));
});
