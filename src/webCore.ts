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

const qwertyToUnique: Record<string, string> = {
  q: "#",
  a: "S-",
  w: "T-",
  s: "K-",
  e: "P-",
  d: "W-",
  r: "H-",
  f: "R-",
  c: "A",
  v: "O",
  n: "E",
  m: "U",
  u: "-F",
  j: "-R",
  i: "-P",
  k: "-B",
  o: "-L",
  l: "-G",
  p: "-T",
  ";": "-S",
  " ": "*",
};

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
    { key: "Enter", label: "Enter", width: 2.25 },
  ],
  [
    { key: "Shift", label: "Shift", width: 2.25 },
    ..."zxcvbnm".split("").map((key) => ({ key, label: key.toUpperCase() })),
    { key: "Shift", label: "Shift", width: 2.25 },
  ],
  [{ key: " ", label: "Spacebar", width: 7 }],
];

const qwertyCodeMap: Record<string, string> = {
  Space: " ",
  Enter: "Enter",
  NumpadEnter: "Enter",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  Semicolon: ";",
};

export function normalizeQwertyDisplayKey(
  key: string,
  code = "",
): string | null {
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

const strokeOrder = [
  "#",
  "S-",
  "T-",
  "K-",
  "P-",
  "W-",
  "H-",
  "R-",
  "A",
  "O",
  "*",
  "E",
  "U",
  "-F",
  "-R",
  "-P",
  "-B",
  "-L",
  "-G",
  "-T",
  "-S",
  "-D",
  "-Z",
];
const middleKeys = ["A", "O", "*", "E", "U"];
const rightStart = strokeOrder.indexOf("-F");
const v7ConsonantPrefixes = [
  "dd",
  "ch",
  "kh",
  "ng",
  "nh",
  "ph",
  "th",
  "tr",
  "0",
  "b",
  "d",
  "g",
  "h",
  "k",
  "l",
  "m",
  "n",
  "p",
  "r",
  "s",
  "t",
  "v",
  "w",
  "x",
  "z",
  "đ",
].sort((a, b) => b.length - a.length);
const v7Vowels = new Set(["a", "e", "i", "o", "u"]);
const v7TonePattern = /^[0-7]$/;
const vietnameseWordPattern = /[\p{L}\p{M}]+/gu;
const piecemealEntryStrokes = new Map<string, number>([
  ["T", 0],
  ["T-", 0],
  ["P", 1],
  ["P-", 1],
  ["H", 2],
  ["H-", 2],
  ["TK", 3],
  ["TK-", 3],
  ["PW", 4],
  ["PW-", 4],
  ["HR", 5],
  ["HR-", 5],
  ["K", 6],
  ["K-", 6],
  ["W", 7],
  ["W-", 7],
  ["R", 8],
  ["R-", 8],
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
    if (
      !hasMiddle &&
      !insertedHyphen &&
      i >= rightStart &&
      strokeKeys.has(key)
    ) {
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

  reset(): void {
    this.heldKeys.clear();
    this.strokeKeys.clear();
  }

  keyDown(
    key: string,
    options: { includeInStroke?: boolean } = {},
  ): string | null {
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

export function renderVisibleText(
  islands: Island[],
  candidates: string[][],
): string {
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
      text +=
        curr.v7Mode === "dictionary" && curr.dictionaryBucketSize === 0
          ? `[dictionary miss: ${curr.value}]`
          : `[${curr.value}]`;
    } else {
      text += curr.value;
    }
  }
  return text;
}

export function renderVisibleTextSegments(
  islands: Island[],
  candidates: string[][],
  piecemealCursorIndex: number | null = null,
  candidateSections: CandidateDiffSection[] = [],
): VisibleTextSegment[] {
  const targets = findPiecemealSyllableTargets(islands);
  const targetIds = new Map<string, { number: number; cursor: boolean }>();
  targets.forEach((target, index) => {
    targetIds.set(targetId(target), {
      number: index + 1,
      cursor: index === piecemealCursorIndex,
    });
  });
  const inferredV7Parts = mapInferredPartsToV7Islands(
    islands,
    candidates[0] ?? null,
  );

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
        segments.push(
          ...renderIslandWithPiecemealTargets(
            inferredPart,
            curr,
            i,
            targetIds,
            0,
            findInferredV7DisplayTargets(inferredPart, curr, i),
          ),
        );
      } else {
        const unresolvedPrefix =
          curr.v7Mode === "dictionary" && curr.dictionaryBucketSize === 0
            ? "[dictionary miss: "
            : "[";
        segments.push(
          ...renderIslandWithPiecemealTargets(
            `${unresolvedPrefix}${curr.value}]`,
            curr,
            i,
            targetIds,
            unresolvedPrefix.length,
          ),
        );
      }
    } else {
      segments.push(
        ...renderIslandWithPiecemealTargets(curr.value, curr, i, targetIds, 0),
      );
    }
  }
  return applyCandidateSectionsToSegments(
    mergePlainSegments(segments),
    candidateSections,
  );
}

export function groupVisibleTextSegmentsByCandidateSection(
  segments: VisibleTextSegment[],
): VisibleTextGroup[] {
  const groups: VisibleTextGroup[] = [];

  for (const segment of segments) {
    const last = groups[groups.length - 1];
    if (last && last.candidateSection === segment.candidateSection) {
      last.segments.push(segment);
    } else {
      groups.push({
        candidateSection: segment.candidateSection,
        segments: [segment],
      });
    }
  }

  return groups;
}

/**
 * Reduces an already annotated buffer to the portion useful to an IME. The
 * piecemeal annotations identify the (at most) nine rightmost Vietnamese
 * syllables, so this deliberately reuses the exact same eligibility rules as
 * piecemeal editing rather than maintaining a second Vietnamese tokenizer.
 */
export function stripVisibleTextSegments(
  segments: VisibleTextSegment[],
): VisibleTextSegment[] {
  const firstSyllable = segments.findIndex(
    (segment) => segment.piecemealNumber !== undefined,
  );
  const visible = firstSyllable < 0 ? segments : segments.slice(firstSyllable);

  return visible
    .map((segment) => {
      // Candidate diff regions are still computed for logging and candidate-list
      // summaries, but the stripped buffer itself should remain visually clean.
      // In particular, do not carry region-box annotations into these segments.
      const { candidateSection: _candidateSection, ...strippedSegment } =
        segment;
      if (strippedSegment.piecemealNumber !== undefined) {
        return { ...strippedSegment };
      }
      if (Array.from(strippedSegment.text).length <= 3) {
        return { ...strippedSegment };
      }
      return { ...strippedSegment, text: "…" };
    })
    .filter((segment) => segment.text !== "");
}

export function getSelectedCandidateText(
  candidates: string[][],
  index: number,
  islands?: Island[],
): string | null {
  const selected = candidates[index];
  if (!selected) return null;
  return islands ? renderCandidateText(islands, selected) : selected.join("");
}

export function selectCandidateIslands(
  candidates: string[][],
  index: number,
  islands?: Island[],
): Island[] | null {
  const chosenText = getSelectedCandidateText(candidates, index, islands);
  if (chosenText === null) return null;
  return [createIsland("vietnamese", chosenText)];
}

export function getPiecemealEntryIndex(stroke: string): number | null {
  return piecemealEntryStrokes.get(stroke) ?? null;
}

export function findPiecemealSyllableTargets(
  islands: Island[],
): PiecemealSyllableTarget[] {
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
  replacement: string,
): Island[] {
  const island = islands[target.islandIndex];
  if (!island) return islands;

  if (target.isV7) {
    const next = [
      ...islands.slice(0, target.islandIndex),
      ...splitV7IslandForReplacement(island, target, replacement),
      ...islands.slice(target.islandIndex + 1),
    ];
    return next.length > 0 ? next : [createIsland("vietnamese", "")];
  }

  const value =
    island.value.slice(0, target.start) +
    replacement +
    island.value.slice(target.end);
  const next = islands.slice();
  next[target.islandIndex] = { ...island, value };
  return next;
}

export function getNextPiecemealCursorIndex(
  currentIndex: number,
  nextTargetCount: number,
): number | null {
  if (currentIndex <= 0) return null;
  const nextIndex = currentIndex - 1;
  return nextIndex < nextTargetCount && nextIndex < 9 ? nextIndex : null;
}

function findV7Syllables(
  value: string,
  islandIndex: number,
): PiecemealSyllableTarget[] {
  const targets: PiecemealSyllableTarget[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = cursor;
    const consonant = v7ConsonantPrefixes.find((prefix) =>
      value.startsWith(prefix, cursor),
    );
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
      isV7: true,
    });
  }
  return targets;
}

function findFixedVietnameseSyllables(
  value: string,
  islandIndex: number,
): PiecemealSyllableTarget[] {
  return [...value.matchAll(vietnameseWordPattern)]
    .filter((match) => isValidVietnameseSyllable(match[0]))
    .map((match, syllableIndex) => ({
      islandIndex,
      syllableIndex,
      text: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      isV7: false,
    }));
}

function findInferredVietnameseSyllables(
  value: string,
  islandIndex: number,
): PiecemealSyllableTarget[] {
  return [...value.matchAll(vietnameseWordPattern)].map(
    (match, syllableIndex) => ({
      islandIndex,
      syllableIndex,
      text: match[0],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      isV7: true,
    }),
  );
}

function splitV7IslandForReplacement(
  island: Island,
  target: PiecemealSyllableTarget,
  replacement: string,
): Island[] {
  const pieces: Island[] = [];
  const residualMode =
    island.v7Mode === "dictionary" ? { v7Mode: "compositional" as const } : {};
  const before = island.value.slice(0, target.start);
  const after = island.value.slice(target.end);
  if (before) pieces.push({ ...island, value: before, ...residualMode });
  pieces.push(
    createIsland(
      "vietnamese",
      island.uppercase || target.syllableIndex === 0
        ? applyIslandCapitalization(island, replacement)
        : replacement,
    ),
  );
  if (after)
    pieces.push({
      ...island,
      value: after,
      capitalize: false,
      ...residualMode,
    });
  return pieces;
}

function renderIslandWithPiecemealTargets(
  renderedValue: string,
  island: Island,
  islandIndex: number,
  targetIds: Map<string, { number: number; cursor: boolean }>,
  offset: number,
  displayTargets?: PiecemealSyllableTarget[],
): VisibleTextSegment[] {
  if (targetIds.size === 0 || island.type !== "vietnamese") {
    return [{ text: renderedValue }];
  }
  const targets =
    displayTargets ??
    (island.isV7
      ? findV7Syllables(island.value, islandIndex)
      : findFixedVietnameseSyllables(island.value, islandIndex));
  const activeTargets = targets.filter((target) =>
    targetIds.has(targetId(target)),
  );
  if (activeTargets.length === 0) return [{ text: renderedValue }];

  const segments: VisibleTextSegment[] = [];
  let cursor = 0;
  for (const target of activeTargets) {
    const start = target.start + offset;
    const end = target.end + offset;
    if (start > cursor)
      segments.push({ text: renderedValue.slice(cursor, start) });
    const marker = targetIds.get(targetId(target));
    segments.push({
      text: renderedValue.slice(start, end),
      piecemealNumber: marker?.number,
      piecemealCursor: marker?.cursor,
    });
    cursor = end;
  }
  if (cursor < renderedValue.length)
    segments.push({ text: renderedValue.slice(cursor) });
  return segments;
}

function mergePlainSegments(
  segments: VisibleTextSegment[],
): VisibleTextSegment[] {
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

export function renderCandidateText(
  islands: Island[],
  topCandidate: string[],
): string {
  if (usesFullAlternatingCandidateShape(islands, topCandidate)) {
    const islandByCandidateIndex = new Map(
      getV7CandidateSlots(islands).map((slot) => [
        slot.fullCandidateIndex,
        islands[slot.islandIndex],
      ]),
    );
    return topCandidate
      .map((part, index) =>
        applyIslandCapitalization(islandByCandidateIndex.get(index), part),
      )
      .join("");
  }

  let text = "";
  let v7PartIndex = 0;
  for (let i = 0; i < islands.length; i++) {
    const curr = islands[i];
    const prev = i > 0 ? islands[i - 1] : null;
    if (prev && shouldAddSpace(prev, curr)) {
      text += " ";
    }
    text += curr.isV7
      ? applyIslandCapitalization(
          curr,
          topCandidate[v7PartIndex++] ?? `[${curr.value}]`,
        )
      : curr.value;
  }
  return text;
}

export function buildCandidateDiffPlan(
  islands: Island[],
  candidates: string[][],
  limit = 5,
): CandidateDiffPlan {
  const visibleCandidates = candidates.slice(0, limit);
  return (
    buildStructuredCandidateDiffPlan(islands, visibleCandidates) ??
    buildCandidateTextDiffPlan(
      visibleCandidates.map((candidate) =>
        renderCandidateText(islands, candidate),
      ),
    )
  );
}

export function buildCandidateTextDiffPlan(
  candidateTexts: string[],
): CandidateDiffPlan {
  const preview = candidateTexts[0] ?? "";
  const baseTokens = tokenizeDiffText(preview);
  const alignments = candidateTexts.map((text) =>
    diffCandidateText(preview, text, baseTokens),
  );
  const sections = chooseCandidateDiffSections(
    preview,
    baseTokens,
    alignments.flatMap((alignment) => alignment.changedIntervals),
  );

  return {
    preview,
    sections,
    candidates: candidateTexts.map((text, index) => {
      const alignment = alignments[index];
      const sectionsForCandidate = sections.map((section) => {
        const range = getCandidateTokenRangeForSection(
          alignment.chunks,
          section,
        );
        const sectionText = sliceTokenRange(
          text,
          alignment.candidateTokens,
          range.start,
          range.end,
        );
        const changes = candidateChangesSection(
          alignment.changedIntervals,
          section,
          baseTokens.length,
        );
        return {
          role: section.role,
          text: changes ? sectionText : section.text,
          changes,
        };
      });

      return {
        text,
        sections: sectionsForCandidate,
        changedRoles: sectionsForCandidate
          .filter((section) => section.changes)
          .map((section) => section.role),
      };
    }),
  };
}

interface DiffToken {
  text: string;
  start: number;
  end: number;
}

interface DiffChunk {
  baseStart: number;
  baseEnd: number;
  candidateStart: number;
  candidateEnd: number;
  equal: boolean;
}

interface CandidateTextAlignment {
  candidateTokens: DiffToken[];
  chunks: DiffChunk[];
  changedIntervals: DiffInterval[];
}

interface DiffInterval {
  start: number;
  end: number;
}

interface TokenRange {
  start: number;
  end: number;
}

interface RenderedCandidatePart {
  tokens: DiffToken[];
}

interface RenderedCandidateWithParts {
  text: string;
  parts: RenderedCandidatePart[];
}

const diffTokenPattern = /\S+/g;
const candidateSectionPenalty = 1;

function tokenizeDiffText(text: string, offset = 0): DiffToken[] {
  return [...text.matchAll(diffTokenPattern)].map((match) => ({
    text: match[0],
    start: offset + (match.index ?? 0),
    end: offset + (match.index ?? 0) + match[0].length,
  }));
}

function buildStructuredCandidateDiffPlan(
  islands: Island[],
  candidates: string[][],
): CandidateDiffPlan | null {
  if (candidates.length === 0) return buildCandidateTextDiffPlan([]);

  // Inference candidates preserve V7 island order, so compare only those replacement parts.
  const renderedCandidates = candidates.map((candidate) =>
    renderCandidateWithV7Parts(islands, candidate),
  );
  const preview = renderedCandidates[0].text;
  const baseParts = renderedCandidates[0].parts;
  if (baseParts.length === 0) return null;
  if (
    !renderedCandidates.every(
      (candidate) => candidate.parts.length === baseParts.length,
    )
  ) {
    return null;
  }

  const baseTokens = baseParts.flatMap((part) => part.tokens);
  const alignments = renderedCandidates.map((candidate) =>
    diffCandidateParts(baseParts, candidate.parts),
  );
  const sections = chooseCandidateDiffSections(
    preview,
    baseTokens,
    alignments.flatMap((alignment) => alignment.changedIntervals),
  );

  return {
    preview,
    sections,
    candidates: renderedCandidates.map((candidate, index) => {
      const alignment = alignments[index];
      const sectionsForCandidate = sections.map((section) => {
        const range = getCandidateTokenRangeForSection(
          alignment.chunks,
          section,
        );
        const sectionText = sliceTokenRange(
          candidate.text,
          alignment.candidateTokens,
          range.start,
          range.end,
        );
        const changes = candidateChangesSection(
          alignment.changedIntervals,
          section,
          baseTokens.length,
        );
        return {
          role: section.role,
          text: changes ? sectionText : section.text,
          changes,
        };
      });

      return {
        text: candidate.text,
        sections: sectionsForCandidate,
        changedRoles: sectionsForCandidate
          .filter((section) => section.changes)
          .map((section) => section.role),
      };
    }),
  };
}

function renderCandidateWithV7Parts(
  islands: Island[],
  candidate: string[],
): RenderedCandidateWithParts {
  if (usesFullAlternatingCandidateShape(islands, candidate)) {
    return renderFullShapeCandidateWithV7Parts(islands, candidate);
  }

  const parts: RenderedCandidatePart[] = [];
  let text = "";
  let v7PartIndex = 0;
  for (let i = 0; i < islands.length; i++) {
    const curr = islands[i];
    const prev = i > 0 ? islands[i - 1] : null;
    if (prev && shouldAddSpace(prev, curr)) {
      text += " ";
    }

    if (curr.isV7) {
      const partText = applyIslandCapitalization(
        curr,
        candidate[v7PartIndex++] ?? `[${curr.value}]`,
      );
      const start = text.length;
      text += partText;
      parts.push({
        tokens: tokenizeDiffText(partText, start),
      });
    } else {
      text += curr.value;
    }
  }

  return { text, parts };
}

function renderFullShapeCandidateWithV7Parts(
  islands: Island[],
  candidate: string[],
): RenderedCandidateWithParts {
  const parts: RenderedCandidatePart[] = [];
  const slotByCandidateIndex = new Map(
    getV7CandidateSlots(islands).map((slot) => [slot.fullCandidateIndex, slot]),
  );
  let text = "";

  for (let i = 0; i < candidate.length; i++) {
    const slot = slotByCandidateIndex.get(i);
    const partText = applyIslandCapitalization(
      slot ? islands[slot.islandIndex] : undefined,
      candidate[i] ?? "",
    );
    const start = text.length;
    text += partText;
    if (slot) {
      parts.push({
        tokens: tokenizeDiffText(partText, start),
      });
    }
  }

  return { text, parts };
}

function diffCandidateParts(
  baseParts: RenderedCandidatePart[],
  candidateParts: RenderedCandidatePart[],
): CandidateTextAlignment {
  const candidateTokens = candidateParts.flatMap((part) => part.tokens);
  const chunks: DiffChunk[] = [];
  const changedIntervals: DiffInterval[] = [];
  let baseOffset = 0;
  let candidateOffset = 0;

  for (let i = 0; i < baseParts.length; i++) {
    const basePart = baseParts[i];
    const candidatePart = candidateParts[i];
    const partChunks = diffTokenValues(
      basePart.tokens.map((token) => token.text),
      candidatePart.tokens.map((token) => token.text),
      baseOffset,
      candidateOffset,
    );

    for (const chunk of partChunks) {
      pushDiffChunk(chunks, chunk);
      if (
        !chunk.equal &&
        (chunk.baseStart !== chunk.baseEnd ||
          chunk.candidateStart !== chunk.candidateEnd)
      ) {
        changedIntervals.push({ start: chunk.baseStart, end: chunk.baseEnd });
      }
    }

    baseOffset += basePart.tokens.length;
    candidateOffset += candidatePart.tokens.length;
  }

  return { candidateTokens, chunks, changedIntervals };
}

function diffCandidateText(
  preview: string,
  candidate: string,
  baseTokens: DiffToken[],
): CandidateTextAlignment {
  const candidateTokens = tokenizeDiffText(candidate);
  if (preview === candidate) {
    return {
      candidateTokens,
      chunks: [
        {
          baseStart: 0,
          baseEnd: baseTokens.length,
          candidateStart: 0,
          candidateEnd: candidateTokens.length,
          equal: true,
        },
      ],
      changedIntervals: [],
    };
  }

  const baseValues = baseTokens.map((token) => token.text);
  const candidateValues = candidateTokens.map((token) => token.text);
  const chunks = diffTokenValues(baseValues, candidateValues, 0, 0);

  return {
    candidateTokens,
    chunks,
    changedIntervals: chunks
      .filter(
        (chunk) =>
          !chunk.equal &&
          (chunk.baseStart !== chunk.baseEnd ||
            chunk.candidateStart !== chunk.candidateEnd),
      )
      .map((chunk) => ({ start: chunk.baseStart, end: chunk.baseEnd })),
  };
}

function diffTokenValues(
  baseValues: string[],
  candidateValues: string[],
  baseOffset: number,
  candidateOffset: number,
): DiffChunk[] {
  const { prefix, baseEnd, candidateEnd } = findCommonTokenEdges(
    baseValues,
    candidateValues,
  );
  const chunks: DiffChunk[] = [];
  pushDiffChunk(chunks, {
    baseStart: baseOffset,
    baseEnd: baseOffset + prefix,
    candidateStart: candidateOffset,
    candidateEnd: candidateOffset + prefix,
    equal: true,
  });

  const baseMiddleLength = baseEnd - prefix;
  const candidateMiddleLength = candidateEnd - prefix;
  const pairedMiddleLength = Math.min(baseMiddleLength, candidateMiddleLength);
  for (let i = 0; i < pairedMiddleLength; i++) {
    const baseIndex = prefix + i;
    const candidateIndex = prefix + i;
    const equal = baseValues[baseIndex] === candidateValues[candidateIndex];
    pushDiffChunk(chunks, {
      baseStart: baseOffset + baseIndex,
      baseEnd: baseOffset + baseIndex + 1,
      candidateStart: candidateOffset + candidateIndex,
      candidateEnd: candidateOffset + candidateIndex + 1,
      equal,
    });
  }
  pushDiffChunk(chunks, {
    baseStart: baseOffset + prefix + pairedMiddleLength,
    baseEnd: baseOffset + baseEnd,
    candidateStart: candidateOffset + prefix + pairedMiddleLength,
    candidateEnd: candidateOffset + candidateEnd,
    equal: false,
  });

  pushDiffChunk(chunks, {
    baseStart: baseOffset + baseEnd,
    baseEnd: baseOffset + baseValues.length,
    candidateStart: candidateOffset + candidateEnd,
    candidateEnd: candidateOffset + candidateValues.length,
    equal: true,
  });

  return chunks;
}

function findCommonTokenEdges(
  baseValues: string[],
  candidateValues: string[],
): { prefix: number; baseEnd: number; candidateEnd: number } {
  let prefix = 0;
  while (
    prefix < baseValues.length &&
    prefix < candidateValues.length &&
    baseValues[prefix] === candidateValues[prefix]
  ) {
    prefix += 1;
  }

  let baseEnd = baseValues.length;
  let candidateEnd = candidateValues.length;
  while (
    baseEnd > prefix &&
    candidateEnd > prefix &&
    baseValues[baseEnd - 1] === candidateValues[candidateEnd - 1]
  ) {
    baseEnd -= 1;
    candidateEnd -= 1;
  }

  return { prefix, baseEnd, candidateEnd };
}

function pushDiffChunk(chunks: DiffChunk[], chunk: DiffChunk): void {
  if (
    chunk.baseStart === chunk.baseEnd &&
    chunk.candidateStart === chunk.candidateEnd
  ) {
    return;
  }

  const last = chunks[chunks.length - 1];
  if (
    last &&
    last.equal === chunk.equal &&
    last.baseEnd === chunk.baseStart &&
    last.candidateEnd === chunk.candidateStart
  ) {
    last.baseEnd = chunk.baseEnd;
    last.candidateEnd = chunk.candidateEnd;
    return;
  }

  chunks.push({ ...chunk });
}

function chooseCandidateDiffSections(
  preview: string,
  baseTokens: DiffToken[],
  intervals: DiffInterval[],
): CandidateDiffSection[] {
  if (baseTokens.length === 0 || intervals.length === 0) return [];

  const changedRuns = mergeChangedTokenIntervals(
    intervals
      .map((interval) => normalizeDiffInterval(interval, baseTokens.length))
      .filter((interval) => interval.end > interval.start),
  );
  if (changedRuns.length === 0) return [];

  let bestGroups = [makeSectionRange(changedRuns, 0, changedRuns.length - 1)];
  let bestScore = scoreSectionRanges(bestGroups, baseTokens);

  for (let split = 1; split < changedRuns.length; split++) {
    const groups = [
      makeSectionRange(changedRuns, 0, split - 1),
      makeSectionRange(changedRuns, split, changedRuns.length - 1),
    ];
    const score = scoreSectionRanges(groups, baseTokens);
    if (score <= bestScore) {
      bestScore = score;
      bestGroups = groups;
    }
  }

  return bestGroups.map((range, index) => ({
    role: index === 0 ? "left" : "right",
    start: baseTokens[range.start]?.start ?? preview.length,
    end: baseTokens[range.end - 1]?.end ?? preview.length,
    tokenStart: range.start,
    tokenEnd: range.end,
    text: sliceTokenRange(preview, baseTokens, range.start, range.end),
  }));
}

function normalizeDiffInterval(
  interval: DiffInterval,
  baseTokenCount: number,
): DiffInterval {
  if (interval.start < interval.end) return interval;
  if (interval.start < baseTokenCount)
    return { start: interval.start, end: interval.start + 1 };
  if (interval.start > 0)
    return { start: interval.start - 1, end: interval.start };
  return { start: 0, end: 0 };
}

function mergeChangedTokenIntervals(intervals: DiffInterval[]): DiffInterval[] {
  if (intervals.length === 0) return [];

  const sorted = intervals
    .map((interval) => ({ ...interval }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: DiffInterval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push(interval);
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  }

  return merged;
}

function makeSectionRange(
  intervals: DiffInterval[],
  startIndex: number,
  endIndex: number,
): TokenRange {
  return {
    start: intervals[startIndex].start,
    end: intervals[endIndex].end,
  };
}

function scoreSectionRanges(ranges: TokenRange[], tokens: DiffToken[]): number {
  return ranges.reduce((sum, range) => {
    const start = tokens[range.start]?.start ?? 0;
    const end = tokens[range.end - 1]?.end ?? start;
    return sum + Math.max(0, end - start);
  }, ranges.length * candidateSectionPenalty);
}

function getCandidateTokenRangeForSection(
  chunks: DiffChunk[],
  section: CandidateDiffSection,
): TokenRange {
  const start = mapBaseBoundaryToCandidate(chunks, section.tokenStart, "start");
  const end = mapBaseBoundaryToCandidate(chunks, section.tokenEnd, "end");
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function mapBaseBoundaryToCandidate(
  chunks: DiffChunk[],
  boundary: number,
  side: "start" | "end",
): number {
  const insertion = chunks.find(
    (chunk) =>
      !chunk.equal &&
      chunk.baseStart === boundary &&
      chunk.baseEnd === boundary &&
      chunk.candidateStart !== chunk.candidateEnd,
  );
  if (insertion) {
    return side === "start" ? insertion.candidateStart : insertion.candidateEnd;
  }

  for (const chunk of chunks) {
    if (boundary === chunk.baseStart) return chunk.candidateStart;
    if (boundary === chunk.baseEnd) return chunk.candidateEnd;
    if (boundary > chunk.baseStart && boundary < chunk.baseEnd) {
      if (chunk.equal) {
        return chunk.candidateStart + (boundary - chunk.baseStart);
      }
      const baseLength = chunk.baseEnd - chunk.baseStart;
      const candidateLength = chunk.candidateEnd - chunk.candidateStart;
      if (baseLength > 0 && candidateLength > 0) {
        const offset = boundary - chunk.baseStart;
        return (
          chunk.candidateStart +
          Math.round((offset / baseLength) * candidateLength)
        );
      }
      return side === "start" ? chunk.candidateStart : chunk.candidateEnd;
    }
  }

  return chunks[chunks.length - 1]?.candidateEnd ?? 0;
}

function candidateChangesSection(
  intervals: DiffInterval[],
  section: CandidateDiffSection,
  baseTokenCount: number,
): boolean {
  return intervals.some((interval) => {
    const normalized = normalizeDiffInterval(interval, baseTokenCount);
    return (
      normalized.start < section.tokenEnd && normalized.end > section.tokenStart
    );
  });
}

function sliceTokenRange(
  text: string,
  tokens: DiffToken[],
  start: number,
  end: number,
): string {
  if (start >= end) return "";
  const startChar = tokens[start]?.start ?? tokens[end - 1]?.end ?? text.length;
  const endChar = tokens[end - 1]?.end ?? startChar;
  return text.slice(startChar, endChar);
}

function applyCandidateSectionsToSegments(
  segments: VisibleTextSegment[],
  sections: CandidateDiffSection[],
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
      const section = sortedSections.find(
        (candidate) => absolute >= candidate.start && absolute < candidate.end,
      );
      const nextBoundary = section
        ? section.end
        : (sortedSections.find((candidate) => candidate.start > absolute)
            ?.start ?? Number.POSITIVE_INFINITY);
      const take = Math.min(
        segment.text.length - segmentOffset,
        nextBoundary - absolute,
      );
      next.push({
        ...segment,
        text: segment.text.slice(segmentOffset, segmentOffset + take),
        ...(section ? { candidateSection: section.role } : {}),
      });
      segmentOffset += take;
    }
    offset += segment.text.length;
  }

  return mergePlainSegments(next);
}

function mapInferredPartsToV7Islands(
  islands: Island[],
  topCandidate: string[] | null,
): Map<number, string> {
  const mapped = new Map<number, string>();
  if (!topCandidate) return mapped;

  const v7Slots = getV7CandidateSlots(islands);
  const usesFullAlternatingShape = usesFullAlternatingCandidateShape(
    islands,
    topCandidate,
  );

  for (let v7Index = 0; v7Index < v7Slots.length; v7Index++) {
    const slot = v7Slots[v7Index];
    const inferred = usesFullAlternatingShape
      ? topCandidate[slot.fullCandidateIndex]
      : topCandidate[v7Index];
    if (inferred) {
      mapped.set(
        slot.islandIndex,
        applyIslandCapitalization(islands[slot.islandIndex], inferred),
      );
    }
  }
  return mapped;
}

function applyIslandCapitalization(
  island: Island | undefined,
  value: string,
): string {
  if (island?.uppercase) return value.toLocaleUpperCase("vi");
  if (!island?.capitalize || value.length === 0) return value;
  return value.charAt(0).toLocaleUpperCase("vi") + value.slice(1);
}

function getV7CandidateSlots(
  islands: Island[],
): { islandIndex: number; fullCandidateIndex: number }[] {
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

function usesFullAlternatingCandidateShape(
  islands: Island[],
  topCandidate: string[],
): boolean {
  const v7Slots = getV7CandidateSlots(islands);
  const lastFullCandidateIndex =
    v7Slots[v7Slots.length - 1]?.fullCandidateIndex ?? -1;
  return topCandidate.length > lastFullCandidateIndex;
}

function findInferredV7DisplayTargets(
  inferredText: string,
  island: Island,
  islandIndex: number,
): PiecemealSyllableTarget[] {
  const rawTargets = findV7Syllables(island.value, islandIndex);
  const inferredTargets = findInferredVietnameseSyllables(
    inferredText,
    islandIndex,
  );

  return inferredTargets.slice(0, rawTargets.length).map((target, index) => ({
    ...target,
    syllableIndex: index,
    isV7: true,
  }));
}
