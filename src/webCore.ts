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

export const qwertyKeyboardLayout: QwertyKeyboardKey[][] = [
  "1234567890".split("").map((key) => ({ key, label: key })),
  "qwertyuiop".split("").map((key) => ({ key, label: key.toUpperCase() })),
  [
    ..."asdfghjkl".split("").map((key) => ({ key, label: key.toUpperCase() })),
    { key: ";", label: ";" },
    { key: "Enter", label: "Enter", width: 2.25 }
  ],
  [
    { key: "Shift", label: "Shift", width: 2.25 },
    ..."zxcvbnm".split("").map((key) => ({ key, label: key.toUpperCase() })),
    { key: "Shift", label: "Shift", width: 2.25 }
  ],
  [{ key: " ", label: "Spacebar", width: 7 }]
];

const qwertyCodeMap: Record<string, string> = {
  Space: " ",
  Enter: "Enter",
  NumpadEnter: "Enter",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  Semicolon: ";"
};

export function normalizeQwertyDisplayKey(key: string, code = ""): string | null {
  if (code in qwertyCodeMap) return qwertyCodeMap[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);

  if (key === " " || key === "Spacebar" || key === "Space") return " ";
  if (key === "Enter") return "Enter";
  if (key === "Shift") return "Shift";

  const normalized = key.toLowerCase();
  if (/^[a-z0-9]$/.test(normalized)) return normalized;
  if (key === ";") return key;
  return null;
}

export function mapKeyUnique(key: string): string | null {
  return requireUiCoreProvider().mapKeyUnique(key);
}

export function serializeStrokeKeys(strokeKeys: Set<string>): string {
  return requireUiCoreProvider().serializeStrokeKeys(Array.from(strokeKeys));
}

export class KeyboardStrokeTracker {
  private heldKeys = new Set<string>();
  private strokeKeys = new Set<string>();

  keyDown(key: string, options: { includeInStroke?: boolean } = {}): string | null {
    const mapped = mapKeyUnique(key);
    if (!mapped) return null;
    this.heldKeys.add(mapped);
    if (options.includeInStroke ?? true) {
      this.strokeKeys.add(mapped);
    }
    return mapped;
  }

  keyUp(key: string): string | null {
    const mapped = mapKeyUnique(key);
    if (!mapped) return null;
    this.heldKeys.delete(mapped);
    if (this.heldKeys.size !== 0 || this.strokeKeys.size === 0) {
      return null;
    }
    const stroke = serializeStrokeKeys(this.strokeKeys);
    this.strokeKeys = new Set<string>();
    return stroke;
  }
}

export function renderVisibleText(islands: Island[], candidates: string[][]): string {
  return requireUiCoreProvider().renderVisibleText(islands, candidates);
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
