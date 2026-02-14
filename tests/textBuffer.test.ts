import fc from "fast-check";
import { Rope } from "../src/rope";
import {
  TextBuffer,
  convertIslandsForInference,
  createIsland,
  shouldAddSpace
} from "../src/textBuffer";

describe("Rope", () => {
  it("concats like strings", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (parts) => {
        const rope = Rope.fromString("");
        let plain = "";
        for (const p of parts) {
          rope.append(p);
          plain += p;
        }
        expect(rope.toString()).toBe(plain);
        expect(rope.length()).toBe(plain.length);
      })
    );
  });
});

describe("TextBuffer undo", () => {
  it("restores previous snapshot after undo", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (segments) => {
        const buffer = new TextBuffer();
        for (const s of segments) {
          buffer.appendVietnamese(s);
        }
        const before = buffer.snapshot();
        const beforeIslands = before.islands.toArray();
        buffer.appendSpacing(" ");
        buffer.appendPunctuation(".");
        expect(buffer.undo()).toBe(true);
        expect(buffer.undo()).toBe(true);
        expect(buffer.getIslands()).toEqual(beforeIslands);
        expect(buffer.pendingCapitalization).toBe(before.pendingCapitalization);
      })
    );
  });

  it("reuses island references without deep cloning", () => {
    const seed = createIsland("vietnamese", "hello");
    const buffer = new TextBuffer([seed]);
    const snap = buffer.snapshot();
    buffer.appendVietnamese("world");
    expect(snap.islands.toArray()[0]).toBe(seed);
    buffer.undo();
    expect(buffer.getIslands()[0]).toBe(seed);
  });

  it("convertIslandsForInference matches spacing rules", () => {
    const islands = [
      createIsland("vietnamese", "xin"),
      createIsland("vietnamese", "chào"),
      createIsland("capital", "1"),
      createIsland("punctuation", ","),
      createIsland("vietnamese", "bạn"),
      createIsland("spacing", "\n"),
      createIsland("vietnamese", "khỏe"),
      createIsland("vietnamese", "không", true)
    ];
    const out = convertIslandsForInference(islands);
    expect(out[0]).toBe("xin chào 1, bạn\nkhỏe ");
    expect(out[1]).toBe("không");
    expect(out[out.length - 1]).toBe("");
    expect(shouldAddSpace(islands[0], islands[1])).toBe(true);
    expect(shouldAddSpace(islands[1], islands[2])).toBe(true);
    expect(shouldAddSpace(islands[3], islands[4])).toBe(true);
  });

  it("uses current explicit spacing for retroactive attachment", () => {
    const prev = createIsland("punctuation", "!", false, { explicitSpacing: true, rightSpace: true });
    const curr = createIsland("vietnamese", "attached", false, { explicitSpacing: true, leftSpace: false });
    const spaced = createIsland("vietnamese", "spaced", false, { explicitSpacing: true, leftSpace: true });

    expect(shouldAddSpace(prev, curr)).toBe(false);
    expect(shouldAddSpace(prev, spaced)).toBe(true);
  });
});
