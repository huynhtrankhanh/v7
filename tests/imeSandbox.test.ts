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
        code: key === " " ? "Space" : `Key${key.toUpperCase()}`,
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

test("a pending Plover mode-exit reset does not strand subsequent V7 inference", async () => {
  const runtime = isolate();
  expect((await runtime.chord(["q"])).snapshot.ploverEnabled).toBe(true);
  const exited = await runtime.chord(["q"]);
  expect(exited.snapshot.ploverEnabled).toBe(false);
  const reset = exited.effects.find(
    (effect) => effect.type === "plover" && effect.method === "reset_state",
  )!;
  expect(reset).toBeDefined();

  // Do not reply to reset: simulate a Plover WebView that is still busy.
  const stroke = await runtime.chord(["c", " ", "m"]);
  const inference = stroke.effects.find((effect) => effect.type === "infer")!;
  expect(inference).toBeDefined();
  expect(stroke.snapshot.text).toContain("["); // Raw V7 telemetry is retained.
  const inferred = await runtime.reply(inference.id, {
    candidates: [["xin chào"]],
  });
  expect(inferred.snapshot.text).toBe("xin chào");
  expect(inferred.snapshot.ploverEnabled).toBe(false);

  await runtime.reply(reset.id, { output: [] });
});

test("Plover translations wait for the reset from the preceding mode exit", async () => {
  const runtime = isolate();
  await runtime.chord(["q"]);
  const exited = await runtime.chord(["q"]);
  const reset = exited.effects.find(
    (effect) => effect.type === "plover" && effect.method === "reset_state",
  )!;
  expect(reset).toBeDefined();

  await runtime.chord(["q"]); // Re-enter Plover before the reset callback.
  const blocked = await runtime.chord(["a"]);
  expect(blocked.effects.some((effect) => effect.method === "translate")).toBe(
    false,
  );

  const ready = await runtime.reply(reset.id, { output: [] });
  const translate = ready.effects.find(
    (effect) => effect.type === "plover" && effect.method === "translate",
  )!;
  expect(translate).toBeDefined();
  const result = await runtime.reply(translate.id, {
    output: [{ type: "preedit", text: "plover" }],
  });
  expect(result.snapshot.text).toBe("plover");
});

test("repeated Plover exits share an outstanding reset without leaving an undispatched reset behind", async () => {
  const runtime = isolate();
  await runtime.chord(["q"]);
  const exited = await runtime.chord(["q"]);
  const reset = exited.effects.find(
    (effect) => effect.method === "reset_state",
  )!;
  expect(reset).toBeDefined();

  await runtime.chord(["q"]);
  const exitedAgain = await runtime.chord(["q"]);
  expect(exitedAgain.snapshot.ploverEnabled).toBe(false);
  expect(
    exitedAgain.effects.some((effect) => effect.method === "reset_state"),
  ).toBe(false);
  await runtime.reply(reset.id, { output: [] });

  const entered = await runtime.chord(["q"]);
  expect(entered.snapshot.ploverEnabled).toBe(true);
  expect(
    entered.effects.some((effect) => effect.method === "reset_state"),
  ).toBe(false);
  const translated = await runtime.chord(["a"]);
  const request = translated.effects.find(
    (effect) => effect.method === "translate",
  )!;
  expect(request).toBeDefined();
  expect(
    (
      await runtime.reply(request.id, {
        output: [{ type: "preedit", text: "ready" }],
      })
    ).snapshot.text,
  ).toBe("ready");
});

test("a one-shot Plover fallback cannot hold a later V7 stroke on reset", async () => {
  const runtime = isolate();
  const fallback = await runtime.chord(["q", "w"]); // #T-: unmatched V7
  const translate = fallback.effects.find(
    (effect) => effect.type === "plover" && effect.method === "translate",
  )!;
  expect(translate).toBeDefined();

  const output = await runtime.reply(translate.id, {
    output: [{ type: "committed", text: "english" }],
  });
  const reset = output.effects.find(
    (effect) => effect.type === "plover" && effect.method === "reset_state",
  )!;
  expect(reset).toBeDefined();

  const stroke = await runtime.chord(["c", " ", "m"]);
  const inference = stroke.effects.find((effect) => effect.type === "infer")!;
  expect(inference).toBeDefined();
  const result = await runtime.reply(inference.id, {
    candidates: [["xin chào"]],
  });
  expect(result.snapshot.text).toContain("xin chào");
  await runtime.reply(reset.id, { output: [] });
});

test("the recorded dictionary phrase survives Plover video and Q returns to V7 with reset delivered", async () => {
  const runtime = isolate();
  const targets: Record<string, string> = {
    chi1thu6: "chính thức",
    su3du5: "sử dụng",
    ti1na0: "tính năng",
    cho0phe6: "cho phép",
  };
  const outlineKeys = (outline: string) => {
    const [left, right] = outline.split("*");
    const keys: Record<string, string> = {
      "#": "q",
      S: "a",
      T: "w",
      K: "s",
      P: "e",
      W: "d",
      H: "r",
      R: "f",
      A: "c",
      O: "v",
      E: "n",
      U: "m",
    };
    const rightKeys: Record<string, string> = {
      E: "n",
      U: "m",
      F: "u",
      R: "j",
      P: "i",
      B: "k",
      L: "o",
      G: "l",
      T: "p",
      S: ";",
      D: "g",
      Z: "h",
    };
    return [
      ...[...left].map((key) => keys[key]),
      " ",
      ...[...right].map((key) => rightKeys[key]),
    ];
  };
  async function infer(packet: Packet) {
    const request = packet.effects.find((effect) => effect.type === "infer")!;
    expect(request).toBeDefined();
    const islands = JSON.parse(request.body).islands as (
      { kind: "fixed"; text: string } | { kind: "v7"; code: string }
    )[];
    return runtime.reply(request.id, {
      candidates: [
        islands.map((island) =>
          island.kind === "fixed" ? island.text : targets[island.code],
        ),
      ],
    });
  }
  await infer(await runtime.chord(outlineKeys("STKHAO*FRLGD")));
  runtime.configure({ slots: [" đưa vào ", ...Array(9).fill(null)] });
  await infer(await runtime.dispatch("clipboard", { slot: 0, copy: false }));
  // The starless dictionary corner has O in the left bank and E in the middle.
  await infer(
    await runtime.chord([
      "a",
      "w",
      "e",
      "f",
      "v",
      "n",
      "u",
      "j",
      "i",
      "k",
      "o",
      "p",
      "g",
      "h",
    ]),
  ); // su3du5
  await infer(await runtime.chord(outlineKeys("TKAO*UFPLDZ")));
  await infer(await runtime.chord(outlineKeys("STHO*RPLGDZ")));
  const phrase = "chính thức đưa vào sử dụng tính năng cho phép";
  expect((await runtime.dispatch("refresh")).snapshot.text).toBe(phrase);

  await infer(await runtime.chord(["q"])); // Enter Plover.
  for (const text of ["phát vid", "phát video"]) {
    const translated = await runtime.chord(["a"]);
    const request = translated.effects.find(
      (effect) => effect.method === "translate",
    )!;
    const raw = await runtime.reply(request.id, {
      output: [{ type: "preedit", text }],
    });
    expect(raw.snapshot.text).toContain("[D: chi1thu6]");
    expect((await infer(raw)).snapshot.text).toBe(phrase + " " + text);
  }

  const exited = await runtime.chord(["q"]);
  expect(exited.snapshot.ploverEnabled).toBe(false);
  expect(exited.snapshot.text).toContain("[D: chi1thu6]");
  const reset = exited.effects.find(
    (effect) => effect.method === "reset_state",
  )!;
  expect(reset).toBeDefined(); // No further key must be needed to publish reset.
  expect((await infer(exited)).snapshot.text).toBe(phrase + " phát video");

  // A delayed reset must not consume or hold the next V7 syllable.
  const continued = await infer(await runtime.chord(["w", "c"]));
  expect(continued.snapshot.text).toBe(phrase + " phát video ta");
  expect(continued.snapshot.ploverEnabled).toBe(false);
  const settled = await runtime.reply(reset.id, { output: [] });
  expect(settled.snapshot.text).toBe(continued.snapshot.text);
  expect(settled.snapshot.ploverEnabled).toBe(false);
});
