import { Island } from "./textBuffer";
import { requireUiCoreProvider } from "./uiCoreProvider";
import { getValidVietnameseSyllables } from "./vietnameseSyllables";

export interface PiecemealSyllableTarget {
  islandIndex: number;
  syllableIndex: number;
  text: string;
  start: number;
  end: number;
  isV7: boolean;
}

export interface VisibleTextSegment {
  text: string;
  piecemealNumber?: number;
  piecemealCursor?: boolean;
  candidateSection?: CandidateDiffSectionRole;
}

export type CandidateDiffSectionRole = "left" | "right";

export interface VisibleTextGroup {
  candidateSection?: CandidateDiffSectionRole;
  segments: VisibleTextSegment[];
}

export interface CandidateDiffSection {
  role: CandidateDiffSectionRole;
  start: number;
  end: number;
  tokenStart: number;
  tokenEnd: number;
  text: string;
}

export interface CandidateDiffPlanCandidateSection {
  role: CandidateDiffSectionRole;
  text: string;
  changes: boolean;
}

export interface CandidateDiffPlanCandidate {
  text: string;
  sections: CandidateDiffPlanCandidateSection[];
  changedRoles: CandidateDiffSectionRole[];
}

export interface CandidateDiffPlan {
  preview: string;
  sections: CandidateDiffSection[];
  candidates: CandidateDiffPlanCandidate[];
}

export interface InferenceRequest {
  needed: boolean;
  islands: string[];
}

export interface ParsedSyllable {
  capitalize: boolean;
  onGlide: boolean;
  initialConsonant: string;
  vowel: string;
  finalConsonant: string;
  tone: string;
}

export interface EmilySymbolResult {
  type: "emily";
  value: string;
  leftSpace: boolean;
  rightSpace: boolean;
  explicitSpacing: boolean;
  capNext: boolean;
  retroSpace: "insert" | "delete" | null;
  repeat: number;
}

export interface RetroactiveSpaceResult {
  islands: Island[];
  changed: boolean;
}

export interface DisplayPlan {
  text: string;
  candidateDiffPlan: CandidateDiffPlan | null;
  visibleGroups: VisibleTextGroup[];
  empty: boolean;
}

let validVietnameseSyllablesCache: string[] | null = null;

function getValidVietnameseSyllablesList(): string[] {
  if (!validVietnameseSyllablesCache) {
    validVietnameseSyllablesCache = Array.from(getValidVietnameseSyllables());
  }
  return validVietnameseSyllablesCache;
}

export interface QwertyKeyboardKey {
  key: string;
  label: string;
  width?: number;
}

export function getQwertyKeyboardLayout(): QwertyKeyboardKey[][] {
  return requireUiCoreProvider().qwertyKeyboardLayout();
}

export function normalizeQwertyDisplayKey(key: string, code = ""): string | null {
  return requireUiCoreProvider().normalizeQwertyDisplayKey(key, code);
}

export function mapKeyUnique(key: string): string | null {
  return requireUiCoreProvider().mapKeyUnique(key);
}

export function serializeStrokeKeys(strokeKeys: Set<string>): string {
  return requireUiCoreProvider().serializeStrokeKeys(Array.from(strokeKeys));
}

export function decodeV7Stroke(stroke: string): string | null {
  return requireUiCoreProvider().decodeV7Stroke(stroke);
}

export function decodePunctuationStroke(stroke: string): string | null {
  return requireUiCoreProvider().decodePunctuationStroke(stroke);
}

export function decodeEmilySymbol(stroke: string): EmilySymbolResult | null {
  return requireUiCoreProvider().decodeEmilySymbol(stroke);
}

export function applyRetroactiveSpace(
  islands: Island[],
  action: "insert" | "delete" | null,
  repeat: number
): RetroactiveSpaceResult {
  return requireUiCoreProvider().applyRetroactiveSpace(islands, action, repeat);
}

export class KeyboardStrokeTracker {
  private tracker = requireUiCoreProvider().createKeyboardStrokeTracker();

  keyDown(key: string, options: { includeInStroke?: boolean } = {}): string | null {
    return this.tracker.keyDown(key, options.includeInStroke ?? true) ?? null;
  }

  keyUp(key: string): string | null {
    return this.tracker.keyUp(key) ?? null;
  }
}

export function renderVisibleText(islands: Island[], candidates: string[][]): string {
  return requireUiCoreProvider().renderVisibleText(islands, candidates);
}

export function buildDisplayPlan(
  islands: Island[],
  candidates: string[][],
  piecemealCursorIndex: number | null = null
): DisplayPlan {
  return requireUiCoreProvider().buildDisplayPlan(
    islands,
    candidates,
    piecemealCursorIndex,
    getValidVietnameseSyllablesList()
  );
}

export function renderVisibleTextSegments(
  islands: Island[],
  candidates: string[][],
  piecemealCursorIndex: number | null = null,
  candidateSections: CandidateDiffSection[] = []
): VisibleTextSegment[] {
  return requireUiCoreProvider().renderVisibleTextSegments(
    islands,
    candidates,
    piecemealCursorIndex,
    candidateSections,
    getValidVietnameseSyllablesList()
  );
}

export function groupVisibleTextSegmentsByCandidateSection(
  segments: VisibleTextSegment[]
): VisibleTextGroup[] {
  return requireUiCoreProvider().groupVisibleTextSegmentsByCandidateSection(segments);
}

export function getSelectedCandidateText(
  candidates: string[][],
  index: number,
  islands?: Island[]
): string | null {
  return requireUiCoreProvider().getSelectedCandidateText(candidates, index, islands);
}

export function selectCandidateIslands(
  candidates: string[][],
  index: number,
  islands?: Island[]
): Island[] | null {
  return requireUiCoreProvider().selectCandidateIslands(candidates, index, islands);
}

export function getPiecemealEntryIndex(stroke: string): number | null {
  return requireUiCoreProvider().getPiecemealEntryIndex(stroke);
}

export function findPiecemealSyllableTargets(islands: Island[]): PiecemealSyllableTarget[] {
  return requireUiCoreProvider().findPiecemealSyllableTargets(
    islands,
    getValidVietnameseSyllablesList()
  );
}

export function replacePiecemealSyllable(
  islands: Island[],
  target: PiecemealSyllableTarget,
  replacement: string
): Island[] {
  return requireUiCoreProvider().replacePiecemealSyllable(islands, target, replacement);
}

export function getNextPiecemealCursorIndex(
  currentIndex: number,
  nextTargetCount: number
): number | null {
  return requireUiCoreProvider().getNextPiecemealCursorIndex(currentIndex, nextTargetCount);
}

export function buildCandidateDiffPlan(
  islands: Island[],
  candidates: string[][],
  limit = 5
): CandidateDiffPlan {
  return requireUiCoreProvider().buildCandidateDiffPlan(islands, candidates, limit);
}

export function buildCandidateTextDiffPlan(candidateTexts: string[]): CandidateDiffPlan {
  return requireUiCoreProvider().buildCandidateTextDiffPlan(candidateTexts);
}
