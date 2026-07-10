import initRustUiCore, {
  KeyboardStrokeTrackerCore,
  assembleSyllableJson,
  buildDisplayPlanJson,
  buildCandidateDiffPlanJson,
  buildCandidateTextDiffPlanJson,
  convertIslandsForInferenceJson,
  decodeV7StrokeJson,
  findPiecemealSyllableTargetsJson,
  getCandidateSelectionMatchJson,
  getInferenceRequestJson,
  getNextPiecemealCursorIndexJson,
  getPiecemealEntryIndexJson,
  getSelectedCandidateTextJson,
  groupVisibleTextSegmentsByCandidateSectionJson,
  mapKeyUnique as rustMapKeyUnique,
  normalizeQwertyDisplayKeyJson,
  parseSyllableStrokeJson,
  qwertyKeyboardLayoutJson,
  renderVisibleTextSegmentsJson,
  renderVisibleTextJson,
  replacePiecemealSyllableJson,
  selectCandidateIslandsJson,
  serializeStrokeKeysJson,
  validVietnameseSyllablesJson
} from "./generated/v7_ui_core/v7_ui_core";
import { setUiCoreProvider } from "./uiCoreProvider";
import { createUiCoreProviderFromWasm } from "./uiCoreWasmAdapter";

let initPromise: Promise<void> | null = null;

export function initializeRustUiCore(onReady?: () => void): Promise<void> {
  if (!initPromise) {
    initPromise = initRustUiCore().then(() => {
      setUiCoreProvider(createUiCoreProviderFromWasm({
        KeyboardStrokeTrackerCore,
        assembleSyllableJson,
        buildDisplayPlanJson,
        buildCandidateDiffPlanJson,
        buildCandidateTextDiffPlanJson,
        convertIslandsForInferenceJson,
        decodeV7StrokeJson,
        findPiecemealSyllableTargetsJson,
        getCandidateSelectionMatchJson,
        getInferenceRequestJson,
        getNextPiecemealCursorIndexJson,
        getPiecemealEntryIndexJson,
        getSelectedCandidateTextJson,
        groupVisibleTextSegmentsByCandidateSectionJson,
        mapKeyUnique: rustMapKeyUnique,
        normalizeQwertyDisplayKeyJson,
        parseSyllableStrokeJson,
        qwertyKeyboardLayoutJson,
        renderVisibleTextSegmentsJson,
        renderVisibleTextJson,
        replacePiecemealSyllableJson,
        selectCandidateIslandsJson,
        serializeStrokeKeysJson,
        validVietnameseSyllablesJson
      }));
    });
  }

  return initPromise.then(() => {
    onReady?.();
  });
}
