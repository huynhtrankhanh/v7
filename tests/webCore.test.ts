import {
  KeyboardStrokeTracker,
  getSelectedCandidateText,
  mapKeyUnique,
  renderVisibleText,
  serializeStrokeKeys,
  selectCandidateIslands
} from "../src/webCore";
import { createIsland } from "../src/textBuffer";

describe("webCore keyboard input", () => {
  test("maps qwerty keys to steno symbols", () => {
    expect(mapKeyUnique("a")).toBe("S-");
    expect(mapKeyUnique(" ")).toBe("*");
    expect(mapKeyUnique("t")).toBe("-D");
    expect(mapKeyUnique("7")).toBe("7");
    expect(mapKeyUnique("/")).toBeNull();
  });

  test("serializes stroke keys in steno order with inferred hyphen", () => {
    const stroke = serializeStrokeKeys(new Set(["S-", "A", "-T"]));
    expect(stroke).toBe("SAT");
    const rightOnly = serializeStrokeKeys(new Set(["-T"]));
    expect(rightOnly).toBe("-T");
  });

  test("emits a stroke when all keys are released", () => {
    const tracker = new KeyboardStrokeTracker();
    tracker.keyDown("a");
    tracker.keyDown("c");
    tracker.keyDown("p");
    expect(tracker.keyUp("a")).toBeNull();
    expect(tracker.keyUp("c")).toBeNull();
    expect(tracker.keyUp("p")).toBe("SAT");
  });
});

describe("webCore candidate selection", () => {
  test("returns joined selected candidate text", () => {
    const candidates = [["xin ", "chào"], ["xin ", "cháo"]];
    expect(getSelectedCandidateText(candidates, 0)).toBe("xin chào");
    expect(getSelectedCandidateText(candidates, 99)).toBeNull();
  });

  test("builds replacement islands for selected candidate", () => {
    const candidates = [["hôm ", "nay"]];
    expect(selectCandidateIslands(candidates, 0)).toEqual([createIsland("vietnamese", "hôm nay")]);
    expect(selectCandidateIslands(candidates, 1)).toBeNull();
  });
});

describe("webCore screen output", () => {
  test("uses top candidate as preview when candidates exist", () => {
    const islands = [createIsland("vietnamese", "raw", true)];
    const candidates = [["đã suy luận"]];
    expect(renderVisibleText(islands, candidates)).toBe("đã suy luận");
  });

  test("renders unresolved v7 islands as raw blocks when no candidates exist", () => {
    const islands = [
      createIsland("vietnamese", "xin"),
      createIsland("vietnamese", "tro2", true),
      createIsland("punctuation", ".")
    ];
    expect(renderVisibleText(islands, [])).toBe("xin [tro2].");
  });
});
