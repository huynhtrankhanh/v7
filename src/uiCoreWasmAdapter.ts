import type { CandidateSelectionMatch } from "./candidateSelection";
import type { Island } from "./textBuffer";
import type {
  CandidateDiffPlan,
  PiecemealSyllableTarget
} from "./webCore";
import type { UiCoreProvider } from "./uiCoreProvider";

export interface UiCoreWasmExports {
  buildCandidateDiffPlanJson(islandsJson: string, candidatesJson: string, limit: number): string;
  buildCandidateTextDiffPlanJson(candidateTextsJson: string): string;
  convertIslandsForInferenceJson(islandsJson: string): string;
  findPiecemealSyllableTargetsJson(islandsJson: string, validSyllablesJson: string): string;
  getCandidateSelectionMatchJson(stroke: string, candidateCount: number): string;
  getNextPiecemealCursorIndexJson(currentIndex: number, nextTargetCount: number): string;
  getPiecemealEntryIndexJson(stroke: string): string;
  getSelectedCandidateTextJson(candidatesJson: string, index: number, islandsJson?: string | null): string;
  mapKeyUnique(key: string): string | undefined;
  renderVisibleTextJson(islandsJson: string, candidatesJson: string): string;
  replacePiecemealSyllableJson(islandsJson: string, targetJson: string, replacement: string): string;
  selectCandidateIslandsJson(candidatesJson: string, index: number, islandsJson?: string | null): string;
  serializeStrokeKeysJson(strokeKeysJson: string): string;
}

function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

function optionalJson(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

function normalizeCandidateCount(candidateCount: number): number {
  return Number.isFinite(candidateCount) ? candidateCount : 0xffffffff;
}

export function createUiCoreProviderFromWasm(wasm: UiCoreWasmExports): UiCoreProvider {
  return {
    mapKeyUnique: (key) => wasm.mapKeyUnique(key) ?? null,
    serializeStrokeKeys: (strokeKeys) => wasm.serializeStrokeKeysJson(JSON.stringify(strokeKeys)),
    getCandidateSelectionMatch: (stroke, candidateCount) =>
      parseJson<CandidateSelectionMatch | null>(
        wasm.getCandidateSelectionMatchJson(stroke, normalizeCandidateCount(candidateCount))
      ),
    renderVisibleText: (islands, candidates) =>
      wasm.renderVisibleTextJson(JSON.stringify(islands), JSON.stringify(candidates)),
    convertIslandsForInference: (islands) =>
      parseJson<string[]>(wasm.convertIslandsForInferenceJson(JSON.stringify(islands))),
    getSelectedCandidateText: (candidates, index, islands) =>
      parseJson<string | null>(
        wasm.getSelectedCandidateTextJson(
          JSON.stringify(candidates),
          index,
          optionalJson(islands)
        )
      ),
    selectCandidateIslands: (candidates, index, islands) =>
      parseJson<Island[] | null>(
        wasm.selectCandidateIslandsJson(
          JSON.stringify(candidates),
          index,
          optionalJson(islands)
        )
      ),
    getPiecemealEntryIndex: (stroke) =>
      parseJson<number | null>(wasm.getPiecemealEntryIndexJson(stroke)),
    findPiecemealSyllableTargets: (islands, validSyllables) =>
      parseJson<PiecemealSyllableTarget[]>(
        wasm.findPiecemealSyllableTargetsJson(
          JSON.stringify(islands),
          JSON.stringify(validSyllables)
        )
      ),
    replacePiecemealSyllable: (islands, target, replacement) =>
      parseJson<Island[]>(
        wasm.replacePiecemealSyllableJson(
          JSON.stringify(islands),
          JSON.stringify(target),
          replacement
        )
      ),
    getNextPiecemealCursorIndex: (currentIndex, nextTargetCount) =>
      parseJson<number | null>(
        wasm.getNextPiecemealCursorIndexJson(currentIndex, nextTargetCount)
      ),
    buildCandidateDiffPlan: (islands, candidates, limit) =>
      parseJson<CandidateDiffPlan>(
        wasm.buildCandidateDiffPlanJson(
          JSON.stringify(islands),
          JSON.stringify(candidates),
          limit
        )
      ),
    buildCandidateTextDiffPlan: (candidateTexts) =>
      parseJson<CandidateDiffPlan>(
        wasm.buildCandidateTextDiffPlanJson(JSON.stringify(candidateTexts))
      )
  };
}
