import {
  KeyboardStrokeTracker,
  findPiecemealSyllableTargets,
  getPiecemealEntryIndex,
  getSelectedCandidateText,
  mapKeyUnique,
  renderVisibleTextSegments,
  renderVisibleText,
  replacePiecemealSyllable,
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

describe("webCore piecemeal syllable edit", () => {
  test("maps entry strokes to the nine rightmost syllable slots", () => {
    expect(getPiecemealEntryIndex("T")).toBe(0);
    expect(getPiecemealEntryIndex("TK")).toBe(3);
    expect(getPiecemealEntryIndex("R")).toBe(8);
    expect(getPiecemealEntryIndex("A")).toBeNull();
  });

  test("finds fixed Vietnamese syllables using the generated valid syllable set", () => {
    const targets = findPiecemealSyllableTargets([
      createIsland("vietnamese", "hello tôi không xyz thẹn")
    ]);

    expect(targets.map((target) => target.text)).toEqual(["tôi", "không", "thẹn"]);
  });

  test("keeps only the nine rightmost syllables across fixed text and v7 islands", () => {
    const targets = findPiecemealSyllableTargets([
      createIsland("vietnamese", "a à ả ã á ạ ai"),
      createIsland("vietnamese", "tro2ma1", true),
      createIsland("vietnamese", "tôi")
    ]);

    expect(targets.map((target) => target.text)).toEqual(["à", "ả", "ã", "á", "ạ", "ai", "tro2", "ma1", "tôi"]);
  });

  test("renders piecemeal numbering and hides the number on the active cursor", () => {
    const segments = renderVisibleTextSegments([
      createIsland("vietnamese", "tôi không thẹn")
    ], [], 1);

    expect(segments).toEqual([
      { text: "tôi", piecemealNumber: 1, piecemealCursor: false },
      { text: " " },
      { text: "không", piecemealNumber: 2, piecemealCursor: true },
      { text: " " },
      { text: "thẹn", piecemealNumber: 3, piecemealCursor: false }
    ]);
  });

  test("renders inferred v7 text while candidates are active", () => {
    const segments = renderVisibleTextSegments([
      createIsland("vietnamese", "tôi"),
      createIsland("vietnamese", "tro2ma1", true)
    ], [["tôi ", "trời mà"]], 0);

    expect(segments).toEqual([
      { text: "tôi", piecemealNumber: 1, piecemealCursor: true },
      { text: " " },
      { text: "trời", piecemealNumber: 2, piecemealCursor: false },
      { text: " " },
      { text: "mà", piecemealNumber: 3, piecemealCursor: false }
    ]);
  });

  test("replaces fixed text syllables in place", () => {
    const islands = [createIsland("vietnamese", "tôi không thẹn")];
    const target = findPiecemealSyllableTargets(islands)[1];
    const next = replacePiecemealSyllable(islands, target, "có");

    expect(next).toEqual([createIsland("vietnamese", "tôi có thẹn")]);
  });

  test("splits v7 islands when replacing a v7 syllable", () => {
    const islands = [createIsland("vietnamese", "tro2ma1", true)];
    const target = findPiecemealSyllableTargets(islands)[0];
    const next = replacePiecemealSyllable(islands, target, "tôi");

    expect(next).toEqual([
      createIsland("vietnamese", "tôi"),
      createIsland("vietnamese", "ma1", true)
    ]);
  });
});
