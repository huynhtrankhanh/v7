import type { CandidateSelectionMatch } from "./candidateSelection";
import type { Island } from "./textBuffer";
import type {
  CandidateDiffPlan,
  PiecemealSyllableTarget
} from "./webCore";
import initRustUiCore, {
  buildCandidateDiffPlanJson,
  buildCandidateTextDiffPlanJson,
  convertIslandsForInferenceJson,
  findPiecemealSyllableTargetsJson,
  getCandidateSelectionMatchJson,
  getNextPiecemealCursorIndexJson,
  getPiecemealEntryIndexJson,
  getSelectedCandidateTextJson,
  mapKeyUnique as rustMapKeyUnique,
  renderVisibleTextJson,
  replacePiecemealSyllableJson,
  selectCandidateIslandsJson,
  serializeStrokeKeysJson
} from "./generated/v7_ui_core/v7_ui_core";
import { setUiCoreProvider } from "./uiCoreProvider";

let initPromise: Promise<void> | null = null;

function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}

function optionalJson(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

export function initializeRustUiCore(onReady?: () => void): Promise<void> {
  if (!initPromise) {
    initPromise = initRustUiCore().then(() => {
      setUiCoreProvider({
        mapKeyUnique: (key) => rustMapKeyUnique(key) ?? null,
        serializeStrokeKeys: (strokeKeys) => serializeStrokeKeysJson(JSON.stringify(strokeKeys)),
        getCandidateSelectionMatch: (stroke, candidateCount) =>
          parseJson<CandidateSelectionMatch | null>(
            getCandidateSelectionMatchJson(stroke, candidateCount)
          ),
        renderVisibleText: (islands, candidates) =>
          renderVisibleTextJson(JSON.stringify(islands), JSON.stringify(candidates)),
        convertIslandsForInference: (islands) =>
          parseJson<string[]>(convertIslandsForInferenceJson(JSON.stringify(islands))),
        getSelectedCandidateText: (candidates, index, islands) =>
          parseJson<string | null>(
            getSelectedCandidateTextJson(
              JSON.stringify(candidates),
              index,
              optionalJson(islands)
            )
          ),
        selectCandidateIslands: (candidates, index, islands) =>
          parseJson<Island[] | null>(
            selectCandidateIslandsJson(
              JSON.stringify(candidates),
              index,
              optionalJson(islands)
            )
          ),
        getPiecemealEntryIndex: (stroke) =>
          parseJson<number | null>(getPiecemealEntryIndexJson(stroke)),
        findPiecemealSyllableTargets: (islands, validSyllables) =>
          parseJson<PiecemealSyllableTarget[]>(
            findPiecemealSyllableTargetsJson(
              JSON.stringify(islands),
              JSON.stringify(validSyllables)
            )
          ),
        replacePiecemealSyllable: (islands, target, replacement) =>
          parseJson<Island[]>(
            replacePiecemealSyllableJson(
              JSON.stringify(islands),
              JSON.stringify(target),
              replacement
            )
          ),
        getNextPiecemealCursorIndex: (currentIndex, nextTargetCount) =>
          parseJson<number | null>(
            getNextPiecemealCursorIndexJson(currentIndex, nextTargetCount)
          ),
        buildCandidateDiffPlan: (islands, candidates, limit) =>
          parseJson<CandidateDiffPlan>(
            buildCandidateDiffPlanJson(
              JSON.stringify(islands),
              JSON.stringify(candidates),
              limit
            )
          ),
        buildCandidateTextDiffPlan: (candidateTexts) =>
          parseJson<CandidateDiffPlan>(
            buildCandidateTextDiffPlanJson(JSON.stringify(candidateTexts))
          )
      });
    });
  }

  return initPromise.then(() => {
    onReady?.();
  });
}
