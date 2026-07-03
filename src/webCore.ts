import { Island, createIsland, shouldAddSpace } from "./textBuffer";
import { isValidVietnameseSyllable } from "./vietnameseSyllables";

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
}

const qwertyToUnique: Record<string, string> = {
  "q": "#", "a": "S-", "w": "T-", "s": "K-", "e": "P-", "d": "W-", "r": "H-", "f": "R-",
  "c": "A", "v": "O",
  "n": "E", "m": "U",
  "u": "-F", "j": "-R", "i": "-P", "k": "-B", "o": "-L", "l": "-G", "p": "-T", ";": "-S",
  " ": "*"
};

const strokeOrder = [
  "#", "S-", "T-", "K-", "P-", "W-", "H-", "R-",
  "A", "O", "*", "E", "U",
  "-F", "-R", "-P", "-B", "-L", "-G", "-T", "-S", "-D", "-Z"
];
const middleKeys = ["A", "O", "*", "E", "U"];
const rightStart = strokeOrder.indexOf("-F");
const v7ConsonantPrefixes = [
  "dd", "ch", "kh", "ng", "nh", "ph", "th", "tr",
  "0", "b", "d", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "x", "z", "đ"
].sort((a, b) => b.length - a.length);
const v7Vowels = new Set(["a", "e", "i", "o", "u"]);
const v7TonePattern = /^[0-7]$/;
const vietnameseWordPattern = /[\p{L}\p{M}]+/gu;
const piecemealEntryStrokes = new Map<string, number>([
  ["T", 0], ["T-", 0],
  ["P", 1], ["P-", 1],
  ["H", 2], ["H-", 2],
  ["TK", 3], ["TK-", 3],
  ["PW", 4], ["PW-", 4],
  ["HR", 5], ["HR-", 5],
  ["K", 6], ["K-", 6],
  ["W", 7], ["W-", 7],
  ["R", 8], ["R-", 8]
]);

export function mapKeyUnique(key: string): string | null {
  const k = key.toLowerCase();
  if (k === "t" || k === "g") return "-D";
  if (k === "y" || k === "h") return "-Z";
  if (k >= "0" && k <= "9") return k;
  return qwertyToUnique[k] || null;
}

export function serializeStrokeKeys(strokeKeys: Set<string>): string {
  const hasMiddle = middleKeys.some((k) => strokeKeys.has(k));
  let stroke = "";
  let insertedHyphen = false;

  for (let i = 0; i < strokeOrder.length; i++) {
    const key = strokeOrder[i];
    if (!hasMiddle && !insertedHyphen && i >= rightStart && strokeKeys.has(key)) {
      stroke += "-";
      insertedHyphen = true;
    }
    if (strokeKeys.has(key)) {
      stroke += key.replace("-", "");
    }
  }

  return stroke;
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
  if (candidates.length > 0) {
    return renderCandidateText(islands, candidates[0]);
  }

  let text = "";
  for (let i = 0; i < islands.length; i++) {
    const curr = islands[i];
    const prev = i > 0 ? islands[i - 1] : null;
    if (prev && shouldAddSpace(prev, curr)) {
      text += " ";
    }
    if (curr.isV7) {
      text += `[${curr.value}]`;
    } else {
      text += curr.value;
    }
  }
  return text;
}

export function renderVisibleTextSegments(
  islands: Island[],
  candidates: string[][],
  piecemealCursorIndex: number | null = null
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
  return mergePlainSegments(segments);
}

export function getSelectedCandidateText(
  candidates: string[][],
  index: number,
  islands?: Island[]
): string | null {
  const selected = candidates[index];
  if (!selected) return null;
  return islands ? renderCandidateText(islands, selected) : selected.join("");
}

export function selectCandidateIslands(
  candidates: string[][],
  index: number,
  islands?: Island[]
): Island[] | null {
  const chosenText = getSelectedCandidateText(candidates, index, islands);
  if (chosenText === null) return null;
  return [createIsland("vietnamese", chosenText)];
}

export function getPiecemealEntryIndex(stroke: string): number | null {
  return piecemealEntryStrokes.get(stroke) ?? null;
}

export function findPiecemealSyllableTargets(islands: Island[]): PiecemealSyllableTarget[] {
  const targets: PiecemealSyllableTarget[] = [];
  for (let islandIndex = 0; islandIndex < islands.length; islandIndex++) {
    const island = islands[islandIndex];
    if (island.type !== "vietnamese") continue;
    if (island.isV7) {
      targets.push(...findV7Syllables(island.value, islandIndex));
    } else {
      targets.push(...findFixedVietnameseSyllables(island.value, islandIndex));
    }
  }
  return targets.slice(-9).reverse();
}

export function replacePiecemealSyllable(
  islands: Island[],
  target: PiecemealSyllableTarget,
  replacement: string
): Island[] {
  const island = islands[target.islandIndex];
  if (!island) return islands;

  if (target.isV7) {
    const next = [
      ...islands.slice(0, target.islandIndex),
      ...splitV7IslandForReplacement(island, target, replacement),
      ...islands.slice(target.islandIndex + 1)
    ];
    return next.length > 0 ? next : [createIsland("vietnamese", "")];
  }

  const value = island.value.slice(0, target.start) + replacement + island.value.slice(target.end);
  const next = islands.slice();
  next[target.islandIndex] = { ...island, value };
  return next;
}

export function getNextPiecemealCursorIndex(
  currentIndex: number,
  nextTargetCount: number
): number | null {
  if (currentIndex <= 0) return null;
  const nextIndex = currentIndex - 1;
  return nextIndex < nextTargetCount && nextIndex < 9 ? nextIndex : null;
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
      segment.piecemealNumber === undefined
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

export function renderCandidateText(islands: Island[], topCandidate: string[]): string {
  if (usesFullAlternatingCandidateShape(islands, topCandidate)) {
    return topCandidate.join("");
  }

  let text = "";
  let v7PartIndex = 0;
  for (let i = 0; i < islands.length; i++) {
    const curr = islands[i];
    const prev = i > 0 ? islands[i - 1] : null;
    if (prev && shouldAddSpace(prev, curr)) {
      text += " ";
    }
    text += curr.isV7 ? (topCandidate[v7PartIndex++] ?? `[${curr.value}]`) : curr.value;
  }
  return text;
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
