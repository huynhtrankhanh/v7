import { Island, createIsland, shouldAddSpace } from "./textBuffer";
import { requireUiCoreProvider } from "./uiCoreProvider";
import { getValidVietnameseSyllables, isValidVietnameseSyllable } from "./vietnameseSyllables";

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

const v7ConsonantPrefixes = [
  "dd", "ch", "kh", "ng", "nh", "ph", "th", "tr",
  "0", "b", "d", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "x", "z", "đ"
].sort((a, b) => b.length - a.length);
const v7Vowels = new Set(["a", "e", "i", "o", "u"]);
const v7TonePattern = /^[0-7]$/;
const vietnameseWordPattern = /[\p{L}\p{M}]+/gu;
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
  const targets = findPiecemealSyllableTargets(islands);
  const targetIds = new Map<string, { number: number; cursor: boolean }>();
  targets.forEach((target, index) => {
    targetIds.set(targetId(target), { number: index + 1, cursor: index === piecemealCursorIndex });
  });
  const inferredV7Parts = mapInferredPartsToV7Islands(islands, candidates[0] ?? null);

  const segments: VisibleTextSegment[] = [];
  for (let i = 0; i < islands.length; i++) {
    const curr = islands[i];
    const prev = i > 0 ? islands[i - 1] : null;
    if (prev && shouldAddSpace(prev, curr)) {
      segments.push({ text: " " });
    }
    if (curr.isV7) {
      const inferredPart = inferredV7Parts.get(i);
      if (inferredPart) {
        segments.push(...renderIslandWithPiecemealTargets(
          inferredPart,
          curr,
          i,
          targetIds,
          0,
          findInferredV7DisplayTargets(inferredPart, curr, i)
        ));
      } else {
        segments.push(...renderIslandWithPiecemealTargets(`[${curr.value}]`, curr, i, targetIds, 1));
      }
    } else {
      segments.push(...renderIslandWithPiecemealTargets(curr.value, curr, i, targetIds, 0));
    }
  }
  return applyCandidateSectionsToSegments(mergePlainSegments(segments), candidateSections);
}

export function groupVisibleTextSegmentsByCandidateSection(
  segments: VisibleTextSegment[]
): VisibleTextGroup[] {
  const groups: VisibleTextGroup[] = [];

  for (const segment of segments) {
    const last = groups[groups.length - 1];
    if (last && last.candidateSection === segment.candidateSection) {
      last.segments.push(segment);
    } else {
      groups.push({
        candidateSection: segment.candidateSection,
        segments: [segment]
      });
    }
  }

  return groups;
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

function findV7Syllables(value: string, islandIndex: number): PiecemealSyllableTarget[] {
  const targets: PiecemealSyllableTarget[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = cursor;
    const consonant = v7ConsonantPrefixes.find((prefix) => value.startsWith(prefix, cursor));
    if (!consonant) {
      cursor += 1;
      continue;
    }

    cursor += consonant.length;
    const vowel = value[cursor];
    const tone = value[cursor + 1];
    if (!v7Vowels.has(vowel) || !v7TonePattern.test(tone ?? "")) {
      cursor = start + 1;
      continue;
    }

    cursor += 2;
    targets.push({
      islandIndex,
      syllableIndex: targets.length,
      text: value.slice(start, cursor),
      start,
      end: cursor,
      isV7: true
    });
  }
  return targets;
}

function findFixedVietnameseSyllables(value: string, islandIndex: number): PiecemealSyllableTarget[] {
  return [...value.matchAll(vietnameseWordPattern)]
    .filter((match) => isValidVietnameseSyllable(match[0]))
    .map((match, syllableIndex) => ({
      islandIndex,
      syllableIndex,
      text: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      isV7: false
    }));
}

function findInferredVietnameseSyllables(value: string, islandIndex: number): PiecemealSyllableTarget[] {
  return [...value.matchAll(vietnameseWordPattern)]
    .map((match, syllableIndex) => ({
      islandIndex,
      syllableIndex,
      text: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      isV7: true
    }));
}

function splitV7IslandForReplacement(
  island: Island,
  target: PiecemealSyllableTarget,
  replacement: string
): Island[] {
  const pieces: Island[] = [];
  const before = island.value.slice(0, target.start);
  const after = island.value.slice(target.end);
  if (before) pieces.push({ ...island, value: before });
  pieces.push(createIsland("vietnamese", replacement));
  if (after) pieces.push({ ...island, value: after });
  return pieces;
}

function renderIslandWithPiecemealTargets(
  renderedValue: string,
  island: Island,
  islandIndex: number,
  targetIds: Map<string, { number: number; cursor: boolean }>,
  offset: number,
  displayTargets?: PiecemealSyllableTarget[]
): VisibleTextSegment[] {
  if (targetIds.size === 0 || island.type !== "vietnamese") {
    return [{ text: renderedValue }];
  }
  const targets = displayTargets ?? (island.isV7
    ? findV7Syllables(island.value, islandIndex)
    : findFixedVietnameseSyllables(island.value, islandIndex));
  const activeTargets = targets.filter((target) => targetIds.has(targetId(target)));
  if (activeTargets.length === 0) return [{ text: renderedValue }];

  const segments: VisibleTextSegment[] = [];
  let cursor = 0;
  for (const target of activeTargets) {
    const start = target.start + offset;
    const end = target.end + offset;
    if (start > cursor) segments.push({ text: renderedValue.slice(cursor, start) });
    const marker = targetIds.get(targetId(target));
    segments.push({
      text: renderedValue.slice(start, end),
      piecemealNumber: marker?.number,
      piecemealCursor: marker?.cursor
    });
    cursor = end;
  }
  if (cursor < renderedValue.length) segments.push({ text: renderedValue.slice(cursor) });
  return segments;
}

function mergePlainSegments(segments: VisibleTextSegment[]): VisibleTextSegment[] {
  const merged: VisibleTextSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.piecemealNumber === undefined &&
      segment.piecemealNumber === undefined &&
      last.candidateSection === segment.candidateSection
    ) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function targetId(target: PiecemealSyllableTarget): string {
  return `${target.islandIndex}:${target.isV7 ? "v7" : "fixed"}:${target.syllableIndex}`;
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

function applyCandidateSectionsToSegments(
  segments: VisibleTextSegment[],
  sections: CandidateDiffSection[]
): VisibleTextSegment[] {
  if (sections.length === 0) return segments;

  const sortedSections = sections
    .filter((section) => section.end > section.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (sortedSections.length === 0) return segments;

  const next: VisibleTextSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    let segmentOffset = 0;
    while (segmentOffset < segment.text.length) {
      const absolute = offset + segmentOffset;
      const section = sortedSections.find((candidate) =>
        absolute >= candidate.start && absolute < candidate.end
      );
      const nextBoundary = section
        ? section.end
        : sortedSections.find((candidate) => candidate.start > absolute)?.start ?? Number.POSITIVE_INFINITY;
      const take = Math.min(segment.text.length - segmentOffset, nextBoundary - absolute);
      next.push({
        ...segment,
        text: segment.text.slice(segmentOffset, segmentOffset + take),
        ...(section ? { candidateSection: section.role } : {})
      });
      segmentOffset += take;
    }
    offset += segment.text.length;
  }

  return mergePlainSegments(next);
}

function mapInferredPartsToV7Islands(islands: Island[], topCandidate: string[] | null): Map<number, string> {
  const mapped = new Map<number, string>();
  if (!topCandidate) return mapped;

  const v7Slots = getV7CandidateSlots(islands);
  const usesFullAlternatingShape = usesFullAlternatingCandidateShape(islands, topCandidate);

  for (let v7Index = 0; v7Index < v7Slots.length; v7Index++) {
    const slot = v7Slots[v7Index];
    const inferred = usesFullAlternatingShape
      ? topCandidate[slot.fullCandidateIndex]
      : topCandidate[v7Index];
    if (inferred) {
      mapped.set(slot.islandIndex, inferred);
    }
  }
  return mapped;
}

function getV7CandidateSlots(islands: Island[]): { islandIndex: number; fullCandidateIndex: number }[] {
  const v7Slots: { islandIndex: number; fullCandidateIndex: number }[] = [];
  let candidatePartIndex = 0;
  for (let islandIndex = 0; islandIndex < islands.length; islandIndex++) {
    const island = islands[islandIndex];
    if (!island.isV7) continue;
    v7Slots.push({ islandIndex, fullCandidateIndex: candidatePartIndex + 1 });
    candidatePartIndex += 2;
  }
  return v7Slots;
}

function usesFullAlternatingCandidateShape(islands: Island[], topCandidate: string[]): boolean {
  const v7Slots = getV7CandidateSlots(islands);
  const lastFullCandidateIndex = v7Slots[v7Slots.length - 1]?.fullCandidateIndex ?? -1;
  return topCandidate.length > lastFullCandidateIndex;
}

function findInferredV7DisplayTargets(
  inferredText: string,
  island: Island,
  islandIndex: number
): PiecemealSyllableTarget[] {
  const rawTargets = findV7Syllables(island.value, islandIndex);
  const inferredTargets = findInferredVietnameseSyllables(inferredText, islandIndex);

  return inferredTargets.slice(0, rawTargets.length).map((target, index) => ({
    ...target,
    syllableIndex: index,
    isV7: true
  }));
}
