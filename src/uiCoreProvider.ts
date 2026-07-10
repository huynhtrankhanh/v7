import type { Island } from "./textBuffer";
import type {
  CandidateDiffSection,
  CandidateDiffPlan,
  DisplayPlan,
  EmilySymbolResult,
  InferenceRequest,
  ParsedSyllable,
  PiecemealSyllableTarget,
  QwertyKeyboardKey,
  RetroactiveSpaceResult,
  StrokePlan,
  WebAppCoreState,
  VisibleTextGroup,
  VisibleTextSegment
} from "./webCore";

export interface KeyboardStrokeTrackerCore {
  keyDown(key: string, includeInStroke: boolean): string | undefined;
  keyUp(key: string): string | undefined;
}

export interface UndoPolicyCore {
  saveJson(groupJson: string, piecemealCursorIndexJson: string): string;
  savePloverJson(recordHistory: boolean, hadPreedit: boolean, piecemealCursorIndexJson: string): string;
  undoApplied(): void;
}

export interface UiCoreProvider {
  mapKeyUnique(key: string): string | null;
  serializeStrokeKeys(strokeKeys: string[]): string;
  parseSyllableStroke(stroke: string): ParsedSyllable | null;
  assembleSyllable(parsed: ParsedSyllable): string;
  validVietnameseSyllables(): string[];
  decodeV7Stroke(stroke: string): string | null;
  decodePunctuationStroke(stroke: string): string | null;
  decodeEmilySymbol(stroke: string): EmilySymbolResult | null;
  applyRetroactiveSpace(islands: Island[], action: "insert" | "delete" | null, repeat: number): RetroactiveSpaceResult;
  planCoreStroke(state: WebAppCoreState, stroke: string, ploverAvailable: boolean): StrokePlan;
  createUndoPolicy(): UndoPolicyCore;
  createKeyboardStrokeTracker(): KeyboardStrokeTrackerCore;
  qwertyKeyboardLayout(): QwertyKeyboardKey[][];
  normalizeQwertyDisplayKey(key: string, code: string): string | null;
  getCandidateSelectionMatch(stroke: string, candidateCount: number): {
    candidateIndex: number;
    syllableStroke: string | null;
  } | null;
  buildDisplayPlan(
    islands: Island[],
    candidates: string[][],
    piecemealCursorIndex: number | null,
    validSyllables: string[]
  ): DisplayPlan;
  renderVisibleText(islands: Island[], candidates: string[][]): string;
  renderVisibleTextSegments(
    islands: Island[],
    candidates: string[][],
    piecemealCursorIndex: number | null,
    candidateSections: CandidateDiffSection[],
    validSyllables: string[]
  ): VisibleTextSegment[];
  groupVisibleTextSegmentsByCandidateSection(segments: VisibleTextSegment[]): VisibleTextGroup[];
  convertIslandsForInference(islands: Island[]): string[];
  getInferenceRequest(islands: Island[]): InferenceRequest;
  getSelectedCandidateText(candidates: string[][], index: number, islands?: Island[]): string | null;
  selectCandidateIslands(candidates: string[][], index: number, islands?: Island[]): Island[] | null;
  getPiecemealEntryIndex(stroke: string): number | null;
  findPiecemealSyllableTargets(islands: Island[], validSyllables: string[]): PiecemealSyllableTarget[];
  replacePiecemealSyllable(
    islands: Island[],
    target: PiecemealSyllableTarget,
    replacement: string
  ): Island[];
  getNextPiecemealCursorIndex(currentIndex: number, nextTargetCount: number): number | null;
  buildCandidateDiffPlan(islands: Island[], candidates: string[][], limit: number): CandidateDiffPlan;
  buildCandidateTextDiffPlan(candidateTexts: string[]): CandidateDiffPlan;
}

let uiCoreProvider: UiCoreProvider | null = null;

export function setUiCoreProvider(provider: UiCoreProvider | null): void {
  uiCoreProvider = provider;
}

export function getUiCoreProvider(): UiCoreProvider | null {
  return uiCoreProvider;
}

export function requireUiCoreProvider(): UiCoreProvider {
  if (!uiCoreProvider) {
    throw new Error("Rust UI core provider is not initialized.");
  }
  return uiCoreProvider;
}
