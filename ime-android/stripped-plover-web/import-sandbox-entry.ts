import { normalizeSteno, setupStroke } from "@stripped-plover/stroke";

type DictionaryType = "json" | "python";

interface ImportState {
  type: DictionaryType;
  entries: Array<[string, string]>;
  offset: number;
}

declare const android: {
  consumeNamedDataAsArrayBuffer(name: string): Promise<ArrayBuffer>;
};

let state: ImportState | null = null;

function decodeUtf8(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const codeUnits: number[] = [];
  let result = "";

  const flush = () => {
    if (codeUnits.length > 0) {
      result += String.fromCharCode(...codeUnits);
      codeUnits.length = 0;
    }
  };
  const appendCodePoint = (codePoint: number) => {
    if (codePoint <= 0xffff) {
      codeUnits.push(codePoint);
    } else {
      const adjusted = codePoint - 0x10000;
      codeUnits.push(0xd800 + (adjusted >> 10));
      codeUnits.push(0xdc00 + (adjusted & 0x3ff));
    }
    // Avoid exceeding engines' argument-count limits in fromCharCode().
    if (codeUnits.length >= 4096) flush();
  };
  const continuation = (index: number): number => {
    if (index >= bytes.length || (bytes[index] & 0xc0) !== 0x80) {
      throw new Error("Dictionary source is not valid UTF-8");
    }
    return bytes[index] & 0x3f;
  };

  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    if (first <= 0x7f) {
      appendCodePoint(first);
      index += 1;
      continue;
    }

    let codePoint: number;
    let width: number;
    let minimum: number;
    if (first >= 0xc2 && first <= 0xdf) {
      width = 2;
      minimum = 0x80;
      codePoint = first & 0x1f;
    } else if (first >= 0xe0 && first <= 0xef) {
      width = 3;
      minimum = 0x800;
      codePoint = first & 0x0f;
    } else if (first >= 0xf0 && first <= 0xf4) {
      width = 4;
      minimum = 0x10000;
      codePoint = first & 0x07;
    } else {
      throw new Error("Dictionary source is not valid UTF-8");
    }
    for (let offset = 1; offset < width; offset += 1) {
      codePoint = (codePoint << 6) | continuation(index + offset);
    }
    if (
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      throw new Error("Dictionary source is not valid UTF-8");
    }
    appendCodePoint(codePoint);
    index += width;
  }
  flush();
  return result;
}

setupStroke({
  keys: [
    "#",
    "S-",
    "T-",
    "K-",
    "P-",
    "W-",
    "H-",
    "R-",
    "A-",
    "O-",
    "*",
    "-E",
    "-U",
    "-F",
    "-R",
    "-P",
    "-B",
    "-L",
    "-G",
    "-T",
    "-S",
    "-D",
    "-Z",
  ],
  implicitHyphenKeys: new Set(["A-", "O-", "-E", "-U", "*"]),
  numberKey: "#",
  numbers: new Map([
    ["S-", "1-"],
    ["T-", "2-"],
    ["P-", "3-"],
    ["H-", "4-"],
    ["A-", "5-"],
    ["O-", "0-"],
    ["-F", "-6"],
    ["-P", "-7"],
    ["-L", "-8"],
    ["-T", "-9"],
  ]),
  feralNumberKey: true,
  undoStrokeSteno: "*",
});

async function initialize(
  dataName: string,
  type: DictionaryType,
): Promise<string> {
  if (type !== "json" && type !== "python") {
    throw new Error('Dictionary type must be "json" or "python"');
  }
  const buffer = await android.consumeNamedDataAsArrayBuffer(dataName);
  const source = decodeUtf8(buffer);
  if (!source.trim()) throw new Error("Dictionary source is empty");

  if (type === "python") {
    // CPython/Wasm is intentionally not started here. Its browser runtime
    // requires Worker/service-worker I/O, APIs that Android's JavaScriptIsolate
    // does not expose. The engine validates and executes this source after the
    // native transaction restarts the regular Stripped Plover runtime.
    state = { type, entries: [], offset: 0 };
    return JSON.stringify({ type, total: -1 });
  }

  const parsed: unknown = JSON.parse(source);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("JSON dictionary must be an object of stroke translations");
  }
  const entries = Object.entries(parsed as Record<string, unknown>).map(
    ([stroke, translation]) => {
      if (typeof translation !== "string") {
        throw new Error(`Translation for ${stroke} must be a string`);
      }
      return [stroke, translation] as [string, string];
    },
  );
  state = { type, entries, offset: 0 };
  return JSON.stringify({ type, total: entries.length });
}

function nextChunk(maxEntries: number): string {
  if (!state || state.type !== "json") {
    throw new Error("A JSON dictionary has not been initialized");
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) {
    throw new Error("Invalid import chunk size");
  }
  const start = state.offset;
  const end = Math.min(start + maxEntries, state.entries.length);
  const entries = state.entries
    .slice(start, end)
    .map(([stroke, translation]) => [
      normalizeSteno(stroke, false).join("/"),
      translation,
    ]);
  state.offset = end;
  return JSON.stringify({
    entries,
    processed: end,
    total: state.entries.length,
    done: end === state.entries.length,
  });
}

Object.assign(globalThis, {
  V7DictionaryImportSandbox: { initialize, nextChunk },
});
