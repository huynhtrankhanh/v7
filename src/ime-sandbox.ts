import {
  createImeEngine,
  type ImeInputContext,
  type ImeKey,
  type ImeSnapshot,
} from "./imeEngine";

// The isolate exposes a small JSON protocol. Java services inference effects
// immediately; the display WebView never owns input state or acknowledges keys.
interface Effect {
  id: number;
  type: string;
  body?: string;
  method?: string;
  params?: unknown;
  slot?: number;
  text?: string;
}
interface Command {
  type: string;
  context: ImeInputContext;
  event?: ImeKey;
  slot?: number;
  copy?: boolean;
  selected?: string | null;
  index?: number;
}
export function createSandboxProtocol() {
  let engine: ReturnType<typeof createImeEngine> | undefined;
  let snapshot: ImeSnapshot | undefined;
  let sequence = 0;
  let effects: Effect[] = [];
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; type: string }
  >();
  const requestIds = new WeakMap<Promise<unknown>, number>();
  let active = 0;
  let wake: (() => void) | undefined;
  function signal() {
    wake?.();
    wake = undefined;
  }
  function request(type: string, data: Partial<Effect>): Promise<unknown> {
    const id = ++sequence;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, type });
      effects.push({ id, type, ...data });
      signal();
    });
    requestIds.set(promise, id);
    return promise;
  }
  function effect(type: string, data: Partial<Effect> = {}) {
    effects.push({ id: ++sequence, type, ...data });
    signal();
  }
  async function packet(): Promise<string> {
    // Run queued input until it finishes or actually needs a native reply.
    // Messages and clipboard writes don't block input, and an unrelated reset
    // must not strand a runnable continuation outside the returned packet.
    while (
      active &&
      !effects.some(
        (effect) => effect.type === "infer" || effect.type === "plover",
      )
    ) {
      const blocked = engine?.getBlockedPloverRequest();
      const id = blocked ? requestIds.get(blocked) : undefined;
      if (id !== undefined && pending.has(id)) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    const result = JSON.stringify({ snapshot, effects });
    effects = [];
    return result;
  }
  function track(task: Promise<void>) {
    active++;
    void task.finally(() => {
      active--;
      signal();
    });
  }
  async function dispatch(command: Command): Promise<string> {
    if (!engine)
      engine = createImeEngine(
        {
          infer: (body) => request("infer", { body }),
          plover: (method, params) =>
            request("plover", { method, params }) as ReturnType<
              Parameters<typeof createImeEngine>[0]["plover"]
            >,
          snapshot: (next) => {
            snapshot = next;
          },
          setClipboardSlot: (slot, text) => effect("clipboard", { slot, text }),
          message: (text) => effect("message", { text }),
          changeInputMethod: () => effect("switch"),
          undoRawOutlineStroke: () => effect("undoOutline"),
          activity: signal,
        },
        command.context,
      );
    engine.configure(command.context);
    switch (command.type) {
      case "key":
        if (command.event) track(engine.key(command.event));
        break;
      case "clipboard":
        track(
          engine.clipboard(
            command.slot!,
            Boolean(command.copy),
            command.selected,
          ),
        );
        break;
      case "select":
        track(engine.select(command.index!));
        break;
      case "clear":
        engine.clear(command.context.epoch);
        break;
      case "reset":
        engine.reset();
        break;
      case "refresh":
        break;
      default:
        throw new Error(`Unknown input command: ${command.type}`);
    }
    engine.refresh();
    return packet();
  }
  async function reply(
    id: number,
    value: unknown,
    error = "",
  ): Promise<string> {
    const request = pending.get(id);
    if (request) {
      pending.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(value);
    }
    // Let direct reset completion/error handlers publish their nonblocking
    // effects as part of this reply as well.
    await Promise.resolve();
    return packet();
  }
  return { dispatch, reply };
}
Object.assign(globalThis, { v7Input: createSandboxProtocol() });
