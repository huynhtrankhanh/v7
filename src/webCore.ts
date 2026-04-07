import { Island, createIsland, shouldAddSpace } from "./textBuffer";

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
