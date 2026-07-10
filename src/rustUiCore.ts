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
import { createUiCoreProviderFromWasm } from "./uiCoreWasmAdapter";

let initPromise: Promise<void> | null = null;

export function initializeRustUiCore(onReady?: () => void): Promise<void> {
  if (!initPromise) {
    initPromise = initRustUiCore().then(() => {
      setUiCoreProvider(createUiCoreProviderFromWasm({
        buildCandidateDiffPlanJson,
        buildCandidateTextDiffPlanJson,
        convertIslandsForInferenceJson,
        findPiecemealSyllableTargetsJson,
        getCandidateSelectionMatchJson,
        getNextPiecemealCursorIndexJson,
        getPiecemealEntryIndexJson,
        getSelectedCandidateTextJson,
        mapKeyUnique: rustMapKeyUnique,
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
