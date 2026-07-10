import { requireUiCoreProvider } from "./uiCoreProvider";
import type { ParsedSyllable } from "./webCore";

export type { ParsedSyllable };

export function parseSyllableStroke(stroke: string): ParsedSyllable | null {
  return requireUiCoreProvider().parseSyllableStroke(stroke);
}

export function assembleSyllable(parsed: ParsedSyllable): string {
  return requireUiCoreProvider().assembleSyllable(parsed);
}
