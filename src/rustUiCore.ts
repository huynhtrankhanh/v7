import initRustUiCore, {
  KeyboardStrokeTrackerCore,
  buildCandidateDiffPlanJson,
  buildCandidateTextDiffPlanJson,
  convertIslandsForInferenceJson,
  findPiecemealSyllableTargetsJson,
  getCandidateSelectionMatchJson,
  getNextPiecemealCursorIndexJson,
  getPiecemealEntryIndexJson,
  getSelectedCandidateTextJson,
  groupVisibleTextSegmentsByCandidateSectionJson,
  mapKeyUnique as rustMapKeyUnique,
  normalizeQwertyDisplayKeyJson,
  qwertyKeyboardLayoutJson,
  renderVisibleTextSegmentsJson,
  renderVisibleTextJson,
  replacePiecemealSyllableJson,
  selectCandidateIslandsJson,
  serializeStrokeKeysJson
} from "./generated/v7_ui_core/v7_ui_core";
import { setUiCoreProvider } from "./uiCoreProvider";
import { createUiCoreProviderFromWasm } from "./uiCoreWasmAdapter";

let initPromise: Promise<void> | null = null;

export function initializeRustUiCore(onReady?: () => void): Promise<void> {
  if (!initPromise) {
    initPromise = initRustUiCore().then(() => {
      setUiCoreProvider(createUiCoreProviderFromWasm({
        KeyboardStrokeTrackerCore,
        buildCandidateDiffPlanJson,
        buildCandidateTextDiffPlanJson,
        convertIslandsForInferenceJson,
        findPiecemealSyllableTargetsJson,
        getCandidateSelectionMatchJson,
        getNextPiecemealCursorIndexJson,
        getPiecemealEntryIndexJson,
        getSelectedCandidateTextJson,
        groupVisibleTextSegmentsByCandidateSectionJson,
        mapKeyUnique: rustMapKeyUnique,
        normalizeQwertyDisplayKeyJson,
        qwertyKeyboardLayoutJson,
        renderVisibleTextSegmentsJson,
        renderVisibleTextJson,
        replacePiecemealSyllableJson,
        selectCandidateIslandsJson,
        serializeStrokeKeysJson
      }));
    });
  }

  return initPromise.then(() => {
    onReady?.();
  });
}
