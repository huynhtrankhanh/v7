import { requireUiCoreProvider } from "./uiCoreProvider";

let validVietnameseSyllables: Set<string> | null = null;

export function isValidVietnameseSyllable(syllable: string): boolean {
  return getValidVietnameseSyllables().has(syllable.toLocaleLowerCase("vi"));
}

export function getValidVietnameseSyllables(): Set<string> {
  if (!validVietnameseSyllables) {
    validVietnameseSyllables = new Set(requireUiCoreProvider().validVietnameseSyllables());
  }
  return validVietnameseSyllables;
}
