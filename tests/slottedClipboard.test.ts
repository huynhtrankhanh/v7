import {
  clipboardShortcut,
  createSlottedClipboard,
  mountClipboardSlots,
} from "../src/slottedClipboard";
import {
  TextBuffer,
  createIsland,
  convertIslandsForInference,
} from "../src/textBuffer";
import { renderVisibleText } from "../src/editorCore";
import { createUndoManager } from "../src/undoManager";

function nativeStore() {
  let saved: (string | null)[] = Array(10).fill(null);
  return {
    load: () => saved.slice(),
    save: (slot: number, text: string | null) => {
      saved[slot] = text;
      return true;
    },
    clear: () => {
      saved = Array(10).fill(null);
      return true;
    },
  };
}

test("all ten slots persist independently and can be cleared", () => {
  const storage = nativeStore();
  const slots = createSlottedClipboard(storage);
  for (let i = 0; i < 10; i++) slots.set(i, `Tiếng Việt ${i}\n`);
  const reloaded = createSlottedClipboard(storage);
  for (let i = 0; i < 10; i++)
    expect(reloaded.get(i)).toBe(`Tiếng Việt ${i}\n`);
  reloaded.set(0, null);
  expect(createSlottedClipboard(storage).get(0)).toBeNull();
  expect(reloaded.get(9)).not.toBeNull();
  reloaded.clearAll();
  expect(storage.load()).toEqual(Array(10).fill(null));
});

test("corrupt data and unavailable storage leave usable session slots", () => {
  expect(
    createSlottedClipboard({
      load: () => ["bad"],
      save: () => false,
      clear: () => false,
    }).get(0),
  ).toBeNull();
  const slots = createSlottedClipboard({
    load: () => {
      throw new Error("denied");
    },
    save: () => false,
    clear: () => false,
  });
  expect(slots.set(4, "literal")).toBe(false);
  expect(slots.get(4)).toBe("literal");
  expect(slots.isPersistent()).toBe(false);
});

test("shortcuts recognize physical digits and exclude mixed modifiers", () => {
  for (let slot = 0; slot < 10; slot++) {
    expect(
      clipboardShortcut(
        new KeyboardEvent("keydown", { code: `Digit${slot}`, ctrlKey: true }),
      ),
    ).toEqual({ slot, copy: false });
    expect(
      clipboardShortcut(
        new KeyboardEvent("keydown", { key: String(slot), altKey: true }),
      ),
    ).toEqual({ slot, copy: true });
  }
  for (const modifiers of [
    { ctrlKey: true, altKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true },
    {},
  ]) {
    expect(
      clipboardShortcut(
        new KeyboardEvent("keydown", { key: "1", ...modifiers }),
      ),
    ).toBeNull();
  }
});

test("fixed paste preserves exact boundaries in rendering and inference and undoes atomically", () => {
  const buffer = new TextBuffer([createIsland("vietnamese", "xin")]);
  const undo = createUndoManager(buffer, () => {});
  undo.save();
  buffer.appendIsland(createIsland("fixed", "\n chào!  "));
  buffer.appendIsland(createIsland("vietnamese", "bạn"));
  expect(renderVisibleText(buffer.getIslands(), [])).toBe("xin\n chào!  bạn");
  expect(convertIslandsForInference(buffer.getIslands())).toEqual([
    { kind: "fixed", text: "xin\n chào!  bạn" },
  ]);
  expect(undo.undo()).toBe(true);
  expect(renderVisibleText(buffer.getIslands(), [])).toBe("xin");
});

test("Settings edits are observed without overwriting other native slots", () => {
  const storage = nativeStore();
  const slots = createSlottedClipboard(storage);
  storage.save(3, "from Settings");
  expect(slots.get(3)).toBe("from Settings");
  slots.set(1, "copy");
  expect(storage.load()[3]).toBe("from Settings");
  storage.clear();
  expect(slots.get(3)).toBeNull();
});

test("empty clipboard uses zero screen space and only occupied items get buttons", () => {
  document.body.innerHTML =
    '<div id="inference-shell"><div id="workbench"></div></div>';
  const slots = nativeStore();
  const ui = mountClipboardSlots({ paste: jest.fn(), message: jest.fn() });
  ui.update(true, slots.load());
  expect(document.getElementById("clipboard-slots")!.hidden).toBe(true);
  slots.save(4, "literal");
  ui.update(true, slots.load());
  expect(document.getElementById("clipboard-slots")!.hidden).toBe(false);
  const shown = document.querySelectorAll(
    "#clipboard-slots button:not([hidden])",
  );
  expect(shown.length).toBe(1);
  expect(shown[0].getAttribute("aria-label")).toBe("Paste slot 4: literal");
});

test("clipboard boundary undo skips snapshots from Plover's own undo", () => {
  const buffer = new TextBuffer([createIsland("plover", "xin")]);
  const undo = createUndoManager(buffer, () => {});
  undo.save("clipboard:1");
  buffer.appendIsland(createIsland("fixed", " saved "));
  undo.savePlover({ recordHistory: false, hadPreedit: false });
  buffer.appendIsland(createIsland("plover", "chào", { phase: "preedit" }));
  undo.savePlover({ recordHistory: false, hadPreedit: true });
  buffer.removeIslandAt(2); // Plover itself has undone the translation.
  expect(undo.undo("clipboard:1")).toBe(true);
  expect(buffer.getIslands()).toEqual([createIsland("plover", "xin")]);
  expect(undo.undo("missing")).toBe(false);
});
