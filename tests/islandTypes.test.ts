import {
  createIsland,
  convertIslandsForInference,
  Island,
  TextBuffer,
} from "../src/textBuffer";
import {
  findPiecemealSyllableTargets,
  renderCandidateText,
  renderVisibleText,
  replacePiecemealSyllable,
} from "../src/editorCore";

// Compile these contracts without executing intentionally invalid constructors.
function checkIslandTypes(island: Island): void {
  // @ts-expect-error Literal text cannot carry inference settings.
  createIsland("vietnamese", "xin", { mode: "dictionary" });
  // @ts-expect-error Only Plover output has a preedit phase.
  createIsland("v7", "ma1", { phase: "preedit" });
  // @ts-expect-error Dictionary results cannot belong to compositional mode.
  createIsland("v7", "ma1", { mode: "compositional", dictionaryBucketSize: 3 });
  // @ts-expect-error Capitalization is one mutually exclusive choice.
  createIsland("v7", "ma1", { capitalize: true, uppercase: true });
  // @ts-expect-error Fixed islands require an explicit boundary policy.
  const fixed: Island = { type: "fixed", value: "literal" };
  void fixed;
  if (island.type === "v7" && island.mode === "compositional") {
    // @ts-expect-error Narrowing excludes dictionary-only metadata.
    void island.dictionaryBucketSize;
  }
  if (island.type === "plover") {
    // @ts-expect-error Plover text has no V7 capitalization state.
    void island.capitalization;
  }
}
void checkIslandTypes;

test("mixed island kinds retain spacing, literal clipboard bytes, and wire format", () => {
  const islands = [
    createIsland("vietnamese", "xin"),
    createIsland("plover", "chào", { phase: "preedit" }),
    createIsland("fixed", "\n  literal  "),
    createIsland("v7", "ma1", { mode: "dictionary", capitalization: "upper" }),
    createIsland("punctuation", "!"),
  ];
  expect(renderVisibleText(islands, [])).toBe("xin chào\n  literal  [D: ma1]!");
  expect(renderCandidateText(islands, ["mà"])).toBe("xin chào\n  literal  MÀ!");
  expect(convertIslandsForInference(islands)).toEqual([
    { kind: "fixed", text: "xin chào\n  literal  " },
    { kind: "v7", code: "ma1", mode: "dictionary" },
    { kind: "fixed", text: "!" },
  ]);
});

test("Plover syllables remain editable while clipboard text stays literal", () => {
  const islands = [
    createIsland("plover", "xin chào"),
    createIsland("fixed", "bạn"),
  ];
  const targets = findPiecemealSyllableTargets(islands);
  expect(targets.map((target) => target.text)).toEqual(["chào", "xin"]);
  const next = replacePiecemealSyllable(islands, targets[0], "bạn");
  expect(next[0]).toEqual(createIsland("plover", "xin bạn"));
  expect(next[1]).toBe(islands[1]);
});

test("splitting dictionary islands drops dictionary metadata and preserves uppercase", () => {
  const island = createIsland("v7", "tro2ma1", {
    mode: "dictionary",
    dictionaryBucketSize: 12,
    capitalization: "upper",
  });
  const target = findPiecemealSyllableTargets([island])[1];
  const next = replacePiecemealSyllable([island], target, "mà");
  expect(next).toEqual([
    createIsland("vietnamese", "MÀ"),
    createIsland("v7", "ma1", { capitalization: "upper" }),
  ]);
});

test("undo restores Plover preedit phase and spacing overrides", () => {
  const preedit = createIsland("plover", "xin", {
    phase: "preedit",
    spacing: { before: true, after: false },
  });
  const buffer = new TextBuffer([preedit]);
  buffer.save();
  buffer.replaceIslandAt(0, {
    ...preedit,
    phase: "committed",
    spacing: { before: false, after: true },
  });
  buffer.undo();
  expect(buffer.getIslands()).toEqual([preedit]);
});
