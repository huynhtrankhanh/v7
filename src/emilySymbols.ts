/**
 * Emily's capitalization command uses left-hand R instead of star so that the
 * star chord remains available to the two-syllable V7 decoder.
 */
export function isEmilyCapitalizationStroke(stroke: string): boolean {
  return stroke === "WHR";
}

export function isRetiredEmilyCapitalizationStroke(stroke: string): boolean {
  return stroke === "WH*";
}
