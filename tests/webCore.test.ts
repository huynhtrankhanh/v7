import fc from "fast-check";
import {
  KeyboardStrokeTracker,
  findPiecemealSyllableTargets,
  getNextPiecemealCursorIndex,
  getPiecemealEntryIndex,
  getSelectedCandidateText,
  mapKeyUnique,
  renderVisibleTextSegments,
  renderVisibleText,
  replacePiecemealSyllable,
  serializeStrokeKeys,
  selectCandidateIslands
} from "../src/webCore";
import { convertIslandsForInference, createIsland } from "../src/textBuffer";

const v7Consonants = [
  "0", "b", "ch", "d", "g", "h", "k", "kh", "l", "m", "n", "ng", "nh",
  "p", "ph", "r", "s", "t", "th", "tr", "v", "w", "x", "z", "đ", "dd"
];
const v7Vowels = ["a", "e", "i", "o", "u"];
const v7Tones = ["0", "1", "2", "3", "4", "5", "6", "7"];
const inferredWords = [
  "ba", "cá", "dê", "em", "gió", "hoa", "khê", "lúa", "mẹ", "nó",
  "phố", "rồi", "sẽ", "tôi", "thơ", "trẻ", "về", "xưa", "già"
];
const fixedWords = ["a", "à", "ả", "ã", "á", "ạ", "ai", "tôi", "không", "thẹn"];

const v7CodeArbitrary = fc
  .record({
    consonant: fc.constantFrom(...v7Consonants),
    vowel: fc.constantFrom(...v7Vowels),
    tone: fc.constantFrom(...v7Tones)
  })
  .filter(({ consonant, vowel }) => !(consonant === "w" && vowel === "u"))
  .map(({ consonant, vowel, tone }) => `${consonant}${vowel}${tone}`);
const fixedWordArbitrary = fc.constantFrom(...fixedWords);

function expectedNumberedSegments(targetCount: number, cursor: number) {
  return Array.from({ length: targetCount }, (_, index) => ({
    number: targetCount - index,
    cursor: index === targetCount - cursor - 1
  }));
}

function markedSegments(islands: ReturnType<typeof createIsland>[], candidates: string[][], cursor: number) {
  return renderVisibleTextSegments(islands, candidates, cursor)
    .filter((segment) => segment.piecemealNumber !== undefined)
    .map((segment) => ({
      text: segment.text,
      number: segment.piecemealNumber,
      cursor: !!segment.piecemealCursor
    }));
}

function splitIntoThreeChunks<T>(values: T[], firstCut: number, secondCut: number): T[][] {
  const a = Math.min(firstCut, values.length);
  const b = Math.min(a + secondCut, values.length);
  return [values.slice(0, a), values.slice(a, b), values.slice(b)].filter((chunk) => chunk.length > 0);
}

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

  test("builds selected text from replacement-only v7 candidates", () => {
    const islands = [
      createIsland("vietnamese", "tro2ma1", true),
      createIsland("vietnamese", "ko0", true)
    ];
    expect(getSelectedCandidateText([["trời mà", "không"]], 0, islands)).toBe("trời mà không");
    expect(selectCandidateIslands([["trời mà", "không"]], 0, islands)).toEqual([
      createIsland("vietnamese", "trời mà không")
    ]);
  });
});

describe("webCore screen output", () => {
  test("uses top candidate as preview when candidates exist", () => {
    const islands = [createIsland("vietnamese", "raw", true)];
    const candidates = [["đã suy luận"]];
    expect(renderVisibleText(islands, candidates)).toBe("đã suy luận");
  });

  test("renders replacement-only v7 candidates with island spacing", () => {
    const islands = [
      createIsland("vietnamese", "tro2ma1", true),
      createIsland("vietnamese", "ko0", true)
    ];
    expect(renderVisibleText(islands, [["trời mà", "không"]])).toBe("trời mà không");
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

  test("advances forward in text order even though numbering counts from the right", () => {
    expect(getNextPiecemealCursorIndex(8, 9)).toBe(7);
    expect(getNextPiecemealCursorIndex(2, 9)).toBe(1);
    expect(getNextPiecemealCursorIndex(1, 9)).toBe(0);
    expect(getNextPiecemealCursorIndex(0, 9)).toBeNull();
  });

  test("finds fixed Vietnamese syllables using the generated valid syllable set", () => {
    const targets = findPiecemealSyllableTargets([
      createIsland("vietnamese", "hello tôi không xyz thẹn")
    ]);

    expect(targets.map((target) => target.text)).toEqual(["thẹn", "không", "tôi"]);
  });

  test("keeps only the nine rightmost syllables across fixed text and v7 islands", () => {
    const targets = findPiecemealSyllableTargets([
      createIsland("vietnamese", "a à ả ã á ạ ai"),
      createIsland("vietnamese", "tro2ma1", true),
      createIsland("vietnamese", "tôi")
    ]);

    expect(targets.map((target) => target.text)).toEqual(["tôi", "ma1", "tro2", "ai", "ạ", "á", "ã", "ả", "à"]);
  });

  test("renders fixed and v7 syllables as one shared nine-slot highlight sequence", () => {
    const islands = [
      createIsland("vietnamese", "tôi không"),
      createIsland("vietnamese", "tro2ma1", true),
      createIsland("vietnamese", "thẹn về")
    ];

    expect(renderVisibleTextSegments(islands, [["tôi không ", "trời mà", " thẹn về"]], 0)).toEqual([
      { text: "tôi", piecemealNumber: 6, piecemealCursor: false },
      { text: " " },
      { text: "không", piecemealNumber: 5, piecemealCursor: false },
      { text: " " },
      { text: "trời", piecemealNumber: 4, piecemealCursor: false },
      { text: " " },
      { text: "mà", piecemealNumber: 3, piecemealCursor: false },
      { text: " " },
      { text: "thẹn", piecemealNumber: 2, piecemealCursor: false },
      { text: " " },
      { text: "về", piecemealNumber: 1, piecemealCursor: true }
    ]);
  });

  test("parses every v7 code in long compact islands", () => {
    const islands = [
      createIsland("vietnamese", "na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7", true),
      createIsland("vietnamese", "đo7đa1ku3", true)
    ];

    expect(findPiecemealSyllableTargets(islands).map((target) => target.text)).toEqual([
      "ku3", "đa1", "đo7", "me7", "ra6", "no1", "thi2", "mu0", "tro2"
    ]);
  });

  test("renders piecemeal numbering and hides the number on the active cursor", () => {
    const segments = renderVisibleTextSegments([
      createIsland("vietnamese", "tôi không thẹn")
    ], [], 1);

    expect(segments).toEqual([
      { text: "tôi", piecemealNumber: 3, piecemealCursor: false },
      { text: " " },
      { text: "không", piecemealNumber: 2, piecemealCursor: true },
      { text: " " },
      { text: "thẹn", piecemealNumber: 1, piecemealCursor: false }
    ]);
  });

  test("renders inferred v7 text while candidates are active", () => {
    const segments = renderVisibleTextSegments([
      createIsland("vietnamese", "tôi"),
      createIsland("vietnamese", "tro2ma1", true)
    ], [["tôi ", "trời mà"]], 0);

    expect(segments).toEqual([
      { text: "tôi", piecemealNumber: 3, piecemealCursor: false },
      { text: " " },
      { text: "trời", piecemealNumber: 2, piecemealCursor: false },
      { text: " " },
      { text: "mà", piecemealNumber: 1, piecemealCursor: true }
    ]);
  });

  test("maps full-shape inference candidates back to all-v7 syllable highlights", () => {
    const islands = [createIsland("vietnamese", "tro2ma1", true)];
    expect(convertIslandsForInference(islands)).toEqual(["", "tro2ma1", ""]);

    expect(renderVisibleTextSegments(islands, [["", "trời mà", ""]], 0)).toEqual([
      { text: "trời", piecemealNumber: 2, piecemealCursor: false },
      { text: " " },
      { text: "mà", piecemealNumber: 1, piecemealCursor: true }
    ]);
  });

  test("maps replacement-only model candidates back to all-v7 syllable highlights", () => {
    const islands = [
      createIsland("vietnamese", "tro2ma1", true),
      createIsland("vietnamese", "ko0", true)
    ];
    const candidates = [["trời mà", "không"]];

    expect(renderVisibleTextSegments(islands, candidates, 1)).toEqual([
      { text: "trời", piecemealNumber: 3, piecemealCursor: false },
      { text: " " },
      { text: "mà", piecemealNumber: 2, piecemealCursor: true },
      { text: " " },
      { text: "không", piecemealNumber: 1, piecemealCursor: false }
    ]);

    expect(renderVisibleTextSegments(islands, candidates, 2)).toEqual([
      { text: "trời", piecemealNumber: 3, piecemealCursor: true },
      { text: " " },
      { text: "mà", piecemealNumber: 2, piecemealCursor: false },
      { text: " " },
      { text: "không", piecemealNumber: 1, piecemealCursor: false }
    ]);
  });

  test("preserves one highlight per editable v7 syllable for every cursor position", () => {
    const islands = [
      createIsland("vietnamese", "tro2ma1", true),
      createIsland("vietnamese", "ko0", true)
    ];
    const candidates = [["trời mà", "không"]];
    const targetCount = findPiecemealSyllableTargets(islands).length;

    for (let cursor = 0; cursor < targetCount; cursor++) {
      const marked = renderVisibleTextSegments(islands, candidates, cursor)
        .filter((segment) => segment.piecemealNumber !== undefined);

      expect(marked).toHaveLength(targetCount);
      expect(marked.map((segment) => segment.piecemealNumber)).toEqual([3, 2, 1]);
      expect(marked.filter((segment) => segment.piecemealCursor)).toEqual([marked[targetCount - cursor - 1]]);
    }
  });

  test("does not drop inferred v7 highlights for syllables outside the fixed-stroke dictionary", () => {
    const islands = [createIsland("vietnamese", "tro2ma1", true)];

    expect(markedSegments(islands, [["hello xyz"]], 1)).toEqual([
      { text: "hello", number: 2, cursor: true },
      { text: "xyz", number: 1, cursor: false }
    ]);
  });

  test("property: v7 target discovery preserves generated code boundaries", () => {
    fc.assert(
      fc.property(fc.array(v7CodeArbitrary, { minLength: 1, maxLength: 30 }), (codes) => {
        const islands = [createIsland("vietnamese", codes.join(""), true)];
        const expected = codes.slice(-9).reverse();

        expect(findPiecemealSyllableTargets(islands).map((target) => target.text)).toEqual(expected);
      }),
      { numRuns: 500 }
    );
  });

  test("property: v7 inferred highlighting has exactly one marker per editable target", () => {
    fc.assert(
      fc.property(
        fc.array(v7CodeArbitrary, { minLength: 1, maxLength: 24 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        (codes, firstCut, secondCut) => {
          const chunks = splitIntoThreeChunks(codes, firstCut, secondCut);
          const islands = chunks.map((chunk) => createIsland("vietnamese", chunk.join(""), true));
          const candidateParts = chunks.map((chunk, chunkIndex) =>
            chunk.map((_, index) => inferredWords[(chunkIndex + index) % inferredWords.length]).join(" ")
          );
          const targetCount = Math.min(codes.length, 9);

          for (let cursor = 0; cursor < targetCount; cursor++) {
            const marked = markedSegments(islands, [candidateParts], cursor);
            expect(marked).toHaveLength(targetCount);
            expect(marked.map(({ number, cursor }) => ({ number, cursor }))).toEqual(
              expectedNumberedSegments(targetCount, cursor)
            );
            expect(marked.every((segment) => segment.text.length > 0)).toBe(true);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  test("property: mixed fixed and v7 targets share one rightmost-nine sequence", () => {
    fc.assert(
      fc.property(
        fc.array(fixedWordArbitrary, { minLength: 1, maxLength: 12 }),
        fc.array(v7CodeArbitrary, { minLength: 1, maxLength: 18 }),
        fc.integer({ min: 1, max: 8 }),
        (fixed, codes, cut) => {
          const chunks = splitIntoThreeChunks(codes, cut, cut);
          const islands = [
            createIsland("vietnamese", fixed.join(" ")),
            ...chunks.map((chunk) => createIsland("vietnamese", chunk.join(""), true))
          ];
          const candidates = [[
            ...chunks.map((chunk, chunkIndex) =>
              chunk.map((_, index) => inferredWords[(chunkIndex + index) % inferredWords.length]).join(" ")
            )
          ]];
          const targetCount = Math.min(fixed.length + codes.length, 9);

          for (let cursor = 0; cursor < targetCount; cursor++) {
            const marked = markedSegments(islands, candidates, cursor);
            expect(marked).toHaveLength(targetCount);
            expect(marked.map(({ number, cursor }) => ({ number, cursor }))).toEqual(
              expectedNumberedSegments(targetCount, cursor)
            );
          }
        }
      ),
      { numRuns: 300 }
    );
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
      createIsland("vietnamese", "tro2", true),
      createIsland("vietnamese", "tôi")
    ]);
  });
});
