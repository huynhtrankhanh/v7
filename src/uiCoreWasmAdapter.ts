import type { CandidateSelectionMatch } from "./candidateSelection";
import type { Island } from "./textBuffer";
import type {
  CandidateDiffPlan,
  DisplayPlan,
  InferenceRequest,
  ParsedSyllable,
  PiecemealSyllableTarget,
  QwertyKeyboardKey,
  VisibleTextGroup,
  VisibleTextSegment
} from "./webCore";
import type { UiCoreProvider } from "./uiCoreProvider";

export interface UiCoreWasmExports {
  KeyboardStrokeTrackerCore: new () => {
    keyDown(key: string, includeInStroke: boolean): string | undefined;
    keyUp(key: string): string | undefined;
  };
  buildDisplayPlanJson(
    islandsJson: string,
    candidatesJson: string,
    piecemealCursorIndexJson: string,
    validSyllablesJson: string
  ): string;
  buildCandidateDiffPlanJson(islandsJson: string, candidatesJson: string, limit: number): string;
  buildCandidateTextDiffPlanJson(candidateTextsJson: string): string;
  convertIslandsForInferenceJson(islandsJson: string): string;
  findPiecemealSyllableTargetsJson(islandsJson: string, validSyllablesJson: string): string;
  getCandidateSelectionMatchJson(stroke: string, candidateCount: number): string;
  getNextPiecemealCursorIndexJson(currentIndex: number, nextTargetCount: number): string;
  getInferenceRequestJson(islandsJson: string): string;
  getPiecemealEntryIndexJson(stroke: string): string;
  getSelectedCandidateTextJson(candidatesJson: string, index: number, islandsJson?: string | null): string;
  groupVisibleTextSegmentsByCandidateSectionJson(segmentsJson: string): string;
  mapKeyUnique(key: string): string | undefined;
  normalizeQwertyDisplayKeyJson(key: string, code: string): string;
  parseSyllableStrokeJson(stroke: string): string;
  qwertyKeyboardLayoutJson(): string;
  renderVisibleTextJson(islandsJson: string, candidatesJson: string): string;
  renderVisibleTextSegmentsJson(
    islandsJson: string,
    candidatesJson: string,
    piecemealCursorIndexJson: string,
    candidateSectionsJson: string,
    validSyllablesJson: string
  ): string;
  replacePiecemealSyllableJson(islandsJson: string, targetJson: string, replacement: string): string;
  selectCandidateIslandsJson(candidatesJson: string, index: number, islandsJson?: string | null): string;
  serializeStrokeKeysJson(strokeKeysJson: string): string;
  assembleSyllableJson(parsedJson: string): string;
  validVietnameseSyllablesJson(): string;
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
    parseSyllableStroke: (stroke) =>
      parseJson<ParsedSyllable | null>(wasm.parseSyllableStrokeJson(stroke)),
    assembleSyllable: (parsed) =>
      parseJson<string>(wasm.assembleSyllableJson(JSON.stringify(parsed))),
    validVietnameseSyllables: () =>
      parseJson<string[]>(wasm.validVietnameseSyllablesJson()),
    createKeyboardStrokeTracker: () => new wasm.KeyboardStrokeTrackerCore(),
    qwertyKeyboardLayout: () =>
      parseJson<QwertyKeyboardKey[][]>(wasm.qwertyKeyboardLayoutJson()),
    normalizeQwertyDisplayKey: (key, code) =>
      parseJson<string | null>(wasm.normalizeQwertyDisplayKeyJson(key, code)),
    getCandidateSelectionMatch: (stroke, candidateCount) =>
      parseJson<CandidateSelectionMatch | null>(
        wasm.getCandidateSelectionMatchJson(stroke, normalizeCandidateCount(candidateCount))
      ),
    buildDisplayPlan: (islands, candidates, piecemealCursorIndex, validSyllables) =>
      parseJson<DisplayPlan>(
        wasm.buildDisplayPlanJson(
          JSON.stringify(islands),
          JSON.stringify(candidates),
          JSON.stringify(piecemealCursorIndex),
          JSON.stringify(validSyllables)
        )
      ),
    renderVisibleText: (islands, candidates) =>
      wasm.renderVisibleTextJson(JSON.stringify(islands), JSON.stringify(candidates)),
    renderVisibleTextSegments: (
      islands,
      candidates,
      piecemealCursorIndex,
      candidateSections,
      validSyllables
    ) =>
      parseJson<VisibleTextSegment[]>(
        wasm.renderVisibleTextSegmentsJson(
          JSON.stringify(islands),
          JSON.stringify(candidates),
          JSON.stringify(piecemealCursorIndex),
          JSON.stringify(candidateSections),
          JSON.stringify(validSyllables)
        )
      ),
    groupVisibleTextSegmentsByCandidateSection: (segments) =>
      parseJson<VisibleTextGroup[]>(
        wasm.groupVisibleTextSegmentsByCandidateSectionJson(JSON.stringify(segments))
      ),
    convertIslandsForInference: (islands) =>
      parseJson<string[]>(wasm.convertIslandsForInferenceJson(JSON.stringify(islands))),
    getInferenceRequest: (islands) =>
      parseJson<InferenceRequest>(wasm.getInferenceRequestJson(JSON.stringify(islands))),
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
