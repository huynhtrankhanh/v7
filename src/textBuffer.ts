import { Rope } from "./rope";

export type IslandType = "vietnamese" | "punctuation" | "capital" | "spacing";

export interface Island {
  type: IslandType;
  value: string;
  isV7?: boolean;
  leftSpace?: boolean;
  rightSpace?: boolean;
  explicitSpacing?: boolean;
  plover?: boolean;
  ploverPreedit?: boolean;
}

export interface BufferSnapshot {
  islands: Island[];
  pendingCapitalization: boolean;
}

export function createIsland(
  type: IslandType,
  value: string,
  isV7 = false,
  meta: Partial<Island> = {}
): Island {
  return { type, value, isV7, ...meta };
}

export function shouldAddSpace(prev: Island | null, curr: Island | null): boolean {
  if (!prev || !curr) return false;
  if (prev.value === "" && !prev.isV7) return false;
  if (prev.type === "spacing" || curr.type === "spacing") return false;

  if (prev.explicitSpacing || curr.explicitSpacing) {
    return !!prev.rightSpace || !!curr.leftSpace;
  }

  if (curr.type === "punctuation") return false;
  if (prev.type === "punctuation") return true;

  if (prev.type === "capital") {
    if (curr.type === "capital") return false;
    return true;
  }

  if (prev.type === "vietnamese") {
    if (curr.type === "vietnamese") return true;
    if (curr.type === "capital") return true;
  }

  return false;
}

export function convertIslandsForInference(islands: Island[]): string[] {
  const serverIslands: string[] = [];
  let currentFixed = Rope.fromString("");

  for (let i = 0; i < islands.length; i++) {
    const curr = islands[i];

    if (curr.isV7) {
      const prev = i > 0 ? islands[i - 1] : null;
      if (prev && shouldAddSpace(prev, curr)) {
        currentFixed.append(" ");
      }
      const chunk = currentFixed.toString();
      if (chunk !== "") {
        serverIslands.push(chunk);
        currentFixed = Rope.fromString("");
      }
      serverIslands.push(curr.value);
    } else {
      const prev = i > 0 ? islands[i - 1] : null;
      if (prev && shouldAddSpace(prev, curr)) {
        currentFixed.append(" ");
      }
      currentFixed.append(curr.value);
    }
  }

  serverIslands.push(currentFixed.toString());
  return serverIslands;
}

export function ensureString(text: string | undefined | null): string {
  return text || "";
}

export class TextBuffer {
  private islands: Island[];
  private _pendingCapitalization = false;
  private history: BufferSnapshot[] = [];

  constructor(initialIslands?: Island[]) {
    this.islands = initialIslands ? this.cloneIslands(initialIslands) : [createIsland("vietnamese", "")];
  }

  get pendingCapitalization(): boolean {
    return this._pendingCapitalization;
  }

  set pendingCapitalization(value: boolean) {
    this._pendingCapitalization = value;
  }

  getIslands(): Island[] {
    return this.islands;
  }

  setIslands(next: Island[]): void {
    this.islands = this.cloneIslands(next);
  }

  reset(): void {
    this.islands = [createIsland("vietnamese", "")];
    this._pendingCapitalization = false;
    this.history = [];
  }

  clearHistory(): void {
    this.history = [];
  }

  snapshot(): BufferSnapshot {
    return {
      islands: this.cloneIslands(this.islands),
      pendingCapitalization: this._pendingCapitalization
    };
  }

  save(): void {
    this.history.push(this.snapshot());
  }

  undo(): boolean {
    const snap = this.history.pop();
    if (!snap) return false;
    this.setIslands(snap.islands);
    this._pendingCapitalization = snap.pendingCapitalization;
    return true;
  }

  appendVietnamese(text: string, meta: Partial<Island> = {}): void {
    this.save();
    const value = this.applyCapitalization(text);
    this.islands.push(createIsland("vietnamese", value, false, meta));
  }

  appendV7(code: string): void {
    this.save();
    this.islands.push(createIsland("vietnamese", code, true));
  }

  appendSpacing(value: string): void {
    this.save();
    this.islands.push(createIsland("spacing", value));
  }

  appendPunctuation(value: string): void {
    this.save();
    this.islands.push(createIsland("punctuation", value));
  }

  appendCapital(value: string): void {
    this.save();
    this.islands.push(createIsland("capital", value));
  }

  replaceWithText(text: string, meta: Partial<Island> = {}): void {
    this.save();
    this.islands = [createIsland("vietnamese", text, false, meta)];
    this._pendingCapitalization = false;
  }

  private applyCapitalization(text: string): string {
    if (this._pendingCapitalization && text.length > 0) {
      this._pendingCapitalization = false;
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    return text;
  }

  private cloneIslands(source: Island[]): Island[] {
    return source.map((i) => ({ ...i }));
  }
}
import { Rope } from "./rope";
