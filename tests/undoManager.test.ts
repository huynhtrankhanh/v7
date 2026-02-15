import fc from "fast-check";
import { createIsland, TextBuffer } from "../src/textBuffer";
import { createUndoManager } from "../src/undoManager";

function fastSpec<T>(name: string, arbitrary: fc.Arbitrary<T>, run: (value: T) => void): void {
  it(name, () => {
    fc.assert(fc.property(arbitrary, run));
  });
}

describe("undoManager plover behavior", () => {
  it("does not false-group separate plover islands", () => {
    const buffer = new TextBuffer();
    const undoManager = createUndoManager(buffer, () => {});

    undoManager.savePlover({ recordHistory: false, hadPreedit: false });
    buffer.appendIsland(createIsland("vietnamese", "first", false, { plover: true }));

    undoManager.savePlover({ recordHistory: false, hadPreedit: false });
    buffer.appendIsland(createIsland("vietnamese", "second", false, { plover: true }));

    expect(undoManager.undo()).toBe(true);
    expect(buffer.getIslands().map((island) => island.value)).toEqual(["", "first"]);

    expect(undoManager.undo()).toBe(true);
    expect(buffer.getIslands().map((island) => island.value)).toEqual([""]);
    expect(undoManager.undo()).toBe(false);
  });

  fastSpec(
    "keeps all plover actions undoable under random preedit transitions",
    fc
      .tuple(fc.constant(false), fc.array(fc.boolean(), { maxLength: 49 }))
      .map(([first, rest]) => [first, ...rest]),
    (hadPreeditSteps) => {
      const buffer = new TextBuffer();
      const undoManager = createUndoManager(buffer, () => {});
      let expectedUndoSteps = 0;

      for (let i = 0; i < hadPreeditSteps.length; i++) {
        const hadPreedit = hadPreeditSteps[i];
        if (!hadPreedit) {
          expectedUndoSteps += 1;
        }
        undoManager.savePlover({ recordHistory: false, hadPreedit });
        buffer.appendIsland(createIsland("vietnamese", `plover-${i}`, false, { plover: true }));
      }

      let undoSteps = 0;
      while (undoManager.undo()) {
        undoSteps += 1;
      }

      expect(undoSteps).toBe(expectedUndoSteps);
      expect(buffer.getIslands().map((island) => island.value)).toEqual([""]);
    }
  );

  fastSpec(
    "one-shot plover actions stay individually undoable",
    fc.array(fc.string(), { minLength: 1, maxLength: 30 }),
    (parts) => {
      const buffer = new TextBuffer();
      const undoManager = createUndoManager(buffer, () => {});

      for (const part of parts) {
        undoManager.savePlover({ recordHistory: true, hadPreedit: false });
        buffer.appendIsland(createIsland("vietnamese", part, false, { plover: true }));
      }

      let undoSteps = 0;
      while (undoManager.undo()) {
        undoSteps += 1;
      }
      expect(undoSteps).toBe(parts.length);
      expect(buffer.getIslands().map((island) => island.value)).toEqual([""]);
    }
  );
});
