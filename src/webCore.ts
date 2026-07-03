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
const v7SyllablePattern = /[a-z0]+[aeoiu][0-9]/gi;
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
    return candidates[0].join("");
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
  if (candidates.length > 0) {
    return [{ text: candidates[0].join("") }];
  }

  const targets = findPiecemealSyllableTargets(islands);
  const targetIds = new Map<string, { number: number; cursor: boolean }>();
  targets.forEach((target, index) => {
    targetIds.set(targetId(target), { number: index + 1, cursor: index === piecemealCursorIndex });
  });

  const segments: VisibleTextSegment[] = [];
  for (let i = 0; i < islands.length; i++) {
    const curr = islands[i];
    const prev = i > 0 ? islands[i - 1] : null;
    if (prev && shouldAddSpace(prev, curr)) {
      segments.push({ text: " " });
    }
    if (curr.isV7) {
      segments.push(...renderIslandWithPiecemealTargets(`[${curr.value}]`, curr, i, targetIds, 1));
    } else {
      segments.push(...renderIslandWithPiecemealTargets(curr.value, curr, i, targetIds, 0));
    }
  }
  return mergePlainSegments(segments);
}

export function getSelectedCandidateText(candidates: string[][], index: number): string | null {
  const selected = candidates[index];
  if (!selected) return null;
  return selected.join("");
}

export function selectCandidateIslands(candidates: string[][], index: number): Island[] | null {
  const chosenText = getSelectedCandidateText(candidates, index);
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
  return targets.slice(-9);
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

function findV7Syllables(value: string, islandIndex: number): PiecemealSyllableTarget[] {
  return [...value.matchAll(v7SyllablePattern)].map((match, syllableIndex) => ({
    islandIndex,
    syllableIndex,
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    isV7: true
  }));
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
  offset: number
): VisibleTextSegment[] {
  if (targetIds.size === 0 || island.type !== "vietnamese") {
    return [{ text: renderedValue }];
  }
  const targets = island.isV7
    ? findV7Syllables(island.value, islandIndex)
    : findFixedVietnameseSyllables(island.value, islandIndex);
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
  return `${target.islandIndex}:${target.isV7 ? "v7" : "fixed"}:${target.start}:${target.end}`;
}
