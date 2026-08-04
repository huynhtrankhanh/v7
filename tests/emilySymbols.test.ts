import {
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
});
