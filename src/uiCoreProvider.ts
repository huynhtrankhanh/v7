import type { Island } from "./textBuffer";
import type {
  CandidateDiffPlan,
  PiecemealSyllableTarget
} from "./webCore";

export interface UiCoreProvider {
  mapKeyUnique?(key: string): string | null;
  serializeStrokeKeys?(strokeKeys: string[]): string;
  getCandidateSelectionMatch?(stroke: string, candidateCount: number): {
    candidateIndex: number;
    syllableStroke: string | null;
  } | null;
  renderVisibleText?(islands: Island[], candidates: string[][]): string;
  convertIslandsForInference?(islands: Island[]): string[];
  getSelectedCandidateText?(candidates: string[][], index: number, islands?: Island[]): string | null;
  selectCandidateIslands?(candidates: string[][], index: number, islands?: Island[]): Island[] | null;
  getPiecemealEntryIndex?(stroke: string): number | null;
  findPiecemealSyllableTargets?(islands: Island[], validSyllables: string[]): PiecemealSyllableTarget[];
  replacePiecemealSyllable?(
    islands: Island[],
    target: PiecemealSyllableTarget,
    replacement: string
  ): Island[];
  getNextPiecemealCursorIndex?(currentIndex: number, nextTargetCount: number): number | null;
  buildCandidateDiffPlan?(islands: Island[], candidates: string[][], limit: number): CandidateDiffPlan;
  buildCandidateTextDiffPlan?(candidateTexts: string[]): CandidateDiffPlan;
}

let uiCoreProvider: UiCoreProvider | null = null;

export function setUiCoreProvider(provider: UiCoreProvider | null): void {
  uiCoreProvider = provider;
}

export function getUiCoreProvider(): UiCoreProvider | null {
  return uiCoreProvider;
}
