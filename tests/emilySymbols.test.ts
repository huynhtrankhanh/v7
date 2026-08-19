import {
  handleEmilySymbol,
  isEmilyCapitalizationStroke,
  isRetiredEmilyCapitalizationStroke,
} from "../src/emilySymbols";

describe("Emily symbol command strokes", () => {
  test("moves only the former WH* capitalization command to left-hand WHR", () => {
    expect(isEmilyCapitalizationStroke("WHR")).toBe(true);
    expect(isEmilyCapitalizationStroke("WH*")).toBe(false);
    expect(isEmilyCapitalizationStroke("WH")).toBe(false);
    expect(isEmilyCapitalizationStroke("WH-R")).toBe(false);

    expect(isRetiredEmilyCapitalizationStroke("WH*")).toBe(true);
    expect(isRetiredEmilyCapitalizationStroke("WHR")).toBe(false);
  });

  test.each(["WHR", "WHR-L", "WHRA-L", "WHRO-L", "WHRAO-L"])(
    "composes left-R capitalization in %s",
    (stroke) => {
      expect(handleEmilySymbol(stroke)).toMatchObject({ capNext: true });
    },
  );

  test("composes capitalization with variants, patterns, and repeats", () => {
    expect(handleEmilySymbol("WHRE-LS")).toMatchObject({
      value: "∏∏",
      capNext: true,
      repeat: 2,
    });
    expect(handleEmilySymbol("WHRU-LT")).toMatchObject({
      value: "§§§",
      capNext: true,
      repeat: 3,
    });
  });

  test("distinguishes right-hand R and rejects retired star chords", () => {
    expect(handleEmilySymbol("WH-R")).toMatchObject({
      value: ".",
      capNext: false,
    });
    expect(handleEmilySymbol("WHR-R")).toMatchObject({
      value: ".",
      capNext: true,
    });
    expect(handleEmilySymbol("WH*")).toBeNull();
    expect(handleEmilySymbol("WH*-L")).toBeNull();
  });
});
