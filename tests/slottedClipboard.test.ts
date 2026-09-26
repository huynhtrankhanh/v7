import {
  clipboardShortcut,
  createSlottedClipboard,
  SLOT_STORAGE_KEY,
} from "../src/slottedClipboard";
import {
  TextBuffer,
  createIsland,
  convertIslandsForInference,
} from "../src/textBuffer";
import { renderVisibleText } from "../src/editorCore";
import { createUndoManager } from "../src/undoManager";

beforeEach(() => localStorage.clear());

test("all ten slots persist independently and can be cleared", () => {
  const slots = createSlottedClipboard(() => localStorage);
  for (let i = 0; i < 10; i++) slots.set(i, `Tiếng Việt ${i}\n`);
  const reloaded = createSlottedClipboard(() => localStorage);
  for (let i = 0; i < 10; i++)
    expect(reloaded.get(i)).toBe(`Tiếng Việt ${i}\n`);
  reloaded.set(0, null);
  expect(createSlottedClipboard(() => localStorage).get(0)).toBeNull();
  expect(reloaded.get(9)).not.toBeNull();
  reloaded.clearAll();
  expect(JSON.parse(localStorage.getItem(SLOT_STORAGE_KEY)!)).toEqual(
    Array(10).fill(null),
  );
});

test("corrupt data and unavailable storage leave usable session slots", () => {
  localStorage.setItem(SLOT_STORAGE_KEY, '["bad"]');
  expect(createSlottedClipboard(() => localStorage).get(0)).toBeNull();
  const slots = createSlottedClipboard(() => {
    throw new Error("denied");
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
  buffer.appendIsland(
    createIsland("fixed", "\n chào!  ", false, { explicitSpacing: true }),
  );
  buffer.appendIsland(createIsland("vietnamese", "bạn"));
  expect(renderVisibleText(buffer.getIslands(), [])).toBe("xin\n chào!  bạn");
  expect(convertIslandsForInference(buffer.getIslands())).toEqual([
    { kind: "fixed", text: "xin\n chào!  bạn" },
  ]);
  expect(undo.undo()).toBe(true);
  expect(renderVisibleText(buffer.getIslands(), [])).toBe("xin");
});
