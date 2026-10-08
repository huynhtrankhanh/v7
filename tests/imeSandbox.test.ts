/** @jest-environment node */
import { buildSync } from "esbuild";
import { runInNewContext } from "node:vm";
import type { ImeInputContext, ImeSnapshot } from "../src/imeEngine";

const context = (): ImeInputContext => ({
  epoch: 1,
  steno: true,
  telex: false,
  telexReady: true,
  rawOutline: false,
  ploverPaused: false,
  ploverAvailable: true,
  modelState: "ready",
  modelError: "",
  slots: Array(10).fill(null),
});
interface Effect {
  id: number;
  type: string;
  method: string;
  body: string;
  slot: number;
  text: string;
}
interface Packet {
  snapshot: ImeSnapshot;
  effects: Effect[];
}
interface Protocol {
  dispatch(command: Record<string, unknown>): Promise<string>;
  reply(id: number, value: unknown, error?: string): Promise<string>;
}
const bundle = buildSync({
  entryPoints: ["src/ime-sandbox.ts"],
  bundle: true,
  write: false,
  platform: "neutral",
  format: "iife",
  target: "es2020",
}).outputFiles[0].text;
function isolate() {
  const global: { v7Input?: Protocol } = {};
  // No window, document, timers, KeyboardEvent, or AbortController in this VM.
  runInNewContext(bundle, global);
  const protocol = global.v7Input!;
  let current = context();
  async function dispatch(
    type: string,
    data: Record<string, unknown> = {},
  ): Promise<Packet> {
    return JSON.parse(
      await protocol.dispatch({ type, context: current, ...data }),
    );
  }
  const reply = async (
    id: number,
    value: unknown,
    error?: string,
  ): Promise<Packet> => JSON.parse(await protocol.reply(id, value, error));
  const key = (action: string, key: string, capsLock = false) =>
    dispatch("key", {
      event: {
        action,
        key,
        code: "",
        capsLock,
        repeat: false,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        epoch: current.epoch,
      },
    });
  async function chord(keys: string[], capsLock = false) {
    let result: Packet | undefined;
    for (const k of keys) result = await key("keydown", k, capsLock);
    for (const k of keys) result = await key("keyup", k, capsLock);
    return result!;
  }
  return {
    dispatch,
    reply,
    key,
    chord,
    configure(next: Partial<ImeInputContext>) {
      current = { ...current, ...next };
    },
  };
}

test("a burst of strokes completes with no display acknowledgements, including undo and clipboard", async () => {
  const runtime = isolate();
  let packet: Packet | undefined;
  for (let index = 0; index < 150; index++) {
    await runtime.key("keydown", "7");
    packet = await runtime.key("keyup", "7");
  }
  expect(packet!.snapshot.text).toBe("7".repeat(150));
  packet = await runtime.chord([" "]); // *
  expect(packet.snapshot.text).toBe("7".repeat(149));
  runtime.configure({ slots: [" exact\ntext ", ...Array(9).fill(null)] });
  packet = await runtime.dispatch("clipboard", { slot: 0, copy: false });
  expect(packet.snapshot.text).toBe("7".repeat(149) + " exact\ntext ");
  packet = await runtime.chord([" "]);
  expect(packet.snapshot.text).toBe("7".repeat(149));
});

test("V7 inference finishes before the synchronous command returns its final preedit and grammar", async () => {
  const runtime = isolate();
  let packet = await runtime.chord(["c", " ", "m"], true);
  const request = packet.effects.find((effect) => effect.type === "infer")!;
  expect(
    JSON.parse(request.body).islands.filter(
      (island: { kind: string }) => island.kind === "v7",
    ),
  ).toHaveLength(1);
  // Model CPU contention does not discard the pending stroke.
  await new Promise((resolve) => setTimeout(resolve, 150));
  packet = await runtime.reply(request.id, {
    candidates: [["xin chào"], ["xin cháo"]],
  });
  expect(packet.snapshot.text).toBe("XIN CHÀO");
  expect(packet.snapshot.grammarSections.length).toBeGreaterThan(0);
  expect(packet.effects).toEqual([]);
  packet = await runtime.dispatch("select", { index: 1 });
  expect(packet.snapshot.text).toBe("XIN CHÁO");
});

test("a new editor starts empty after a synchronous inference completes", async () => {
  const runtime = isolate();
  const packet = await runtime.chord(["c", " ", "m"]);
  const request = packet.effects.find((effect) => effect.type === "infer")!;
  runtime.configure({ epoch: 2 });
  // Reply first because Android handles inference synchronously and cannot
  // receive a lifecycle callback until it completes; then advance the epoch.
  await runtime.reply(request.id, { candidates: [["old editor"]] });
  expect((await runtime.dispatch("clear")).snapshot.text).toBe("");
  await runtime.key("keydown", "8");
  expect((await runtime.key("keyup", "8")).snapshot.text).toBe("8");
});

test("Plover retains every queued chord and its captured Caps Lock while replies are delayed", async () => {
  const runtime = isolate();
  expect((await runtime.chord(["q"])).snapshot.ploverEnabled).toBe(true);
  const first = await runtime.chord(["a"], true);
  expect(first.effects[0].method).toBe("translate");
  const queued = await runtime.chord(["w"], false);
  expect(queued.effects).toEqual([]);
  const second = await runtime.reply(first.effects[0].id, {
    output: [{ type: "preedit", text: "first" }],
  });
  expect(second.snapshot.text).toBe("FIRST");
  expect(second.effects[0].method).toBe("translate");
  const result = await runtime.reply(second.effects[0].id, {
    output: [{ type: "preedit", text: "first second" }],
  });
  expect(result.snapshot.text).toBe("first second");
});

test("late Plover output cannot restore a cleared editor, and new strokes still run", async () => {
  const runtime = isolate();
  await runtime.chord(["q"]);
  const first = await runtime.chord(["a"]);
  runtime.configure({ epoch: 2 });
  expect((await runtime.dispatch("clear")).snapshot.text).toBe("");
  await runtime.chord(["w"]);
  const second = await runtime.reply(first.effects[0].id, {
    output: [{ type: "preedit", text: "stale" }],
  });
  expect(second.snapshot.text).toBe("");
  expect(second.effects[0].method).toBe("translate");
  const result = await runtime.reply(second.effects[0].id, {
    output: [{ type: "preedit", text: "current" }],
  });
  expect(result.snapshot.text).toBe("current");
});

test("raw outline capture and undo run without the display WebView", async () => {
  const runtime = isolate();
  runtime.configure({ rawOutline: true });
  expect((await runtime.chord(["a"])).snapshot.text).toBe("S");
  expect((await runtime.chord(["w"])).snapshot.text).toBe("S/T");
  expect((await runtime.chord([" "])).snapshot.text).toBe("S");
  expect((await runtime.chord([" "])).snapshot.text).toBe("");
  expect((await runtime.chord([" "])).effects[0].type).toBe("undoOutline");
});
