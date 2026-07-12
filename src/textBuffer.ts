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
  islands: Rope<Island>;
  pendingCapitalization: boolean;
}

export interface HistoryFrameFields {
  piecemealCursorIndex?: number;
}

export type HistorySaveOptions = HistoryFrameFields & {
  group?: string;
};

type HistoryEntry = BufferSnapshot & HistorySaveOptions;

export function createIsland(
  type: IslandType,
  value: string,
  isV7 = false,
  meta: Partial<Island> = {},
): Island {
  return { type, value, isV7, ...meta };
}

export function shouldAddSpace(
  prev: Island | null,
  curr: Island | null,
): boolean {
  if (!prev || !curr) return false;
  if (prev.value === "" && !prev.isV7) return false;
  if (prev.type === "spacing" || curr.type === "spacing") return false;

  if (prev.explicitSpacing || curr.explicitSpacing) {
    if (curr.explicitSpacing) {
      return !!curr.leftSpace;
    }
    return !!prev.rightSpace;
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
      serverIslands.push(chunk);
      currentFixed = Rope.fromString("");
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
  private islands: Rope<Island>;
  private _pendingCapitalization = false;
  private history: HistoryEntry[] = [];

  constructor(initialIslands?: Island[]) {
    const seeds =
      initialIslands && initialIslands.length > 0
        ? initialIslands
        : [createIsland("vietnamese", "")];
    this.islands = Rope.fromArray(seeds, () => 1);
  }

  get pendingCapitalization(): boolean {
    return this._pendingCapitalization;
  }

  set pendingCapitalization(value: boolean) {
    this._pendingCapitalization = value;
  }

  getIslands(): Island[] {
    return this.islands.toArray();
  }

  getIslandCount(): number {
    return this.islands.length();
  }

  getIslandAt(index: number): Island | null {
    return this.islands.getAt(index);
  }

  setIslands(next: Island[]): void {
    this.islands = Rope.fromArray(next, () => 1);
  }

  appendIsland(value: Island): void {
    this.islands.append(value);
  }

  trimTrailingSpaceFromLastVietnameseIsland(): boolean {
    const lastIndex = this.islands.length() - 1;
    if (lastIndex < 0) return false;
    const last = this.islands.getAt(lastIndex);
    if (!last || last.type !== "vietnamese" || !last.value.endsWith(" "))
      return false;
    const trimmedValue = last.value.slice(0, -1);
    return this.islands.replaceAt(lastIndex, { ...last, value: trimmedValue });
  }

  replaceIslandAt(index: number, value: Island): boolean {
    return this.islands.replaceAt(index, value);
  }

  removeIslandAt(index: number): boolean {
    return this.islands.removeAt(index);
  }

  reset(): void {
    this.islands = Rope.fromArray([createIsland("vietnamese", "")], () => 1);
    this._pendingCapitalization = false;
    this.history = [];
  }

  clearHistory(): void {
    this.history = [];
  }

  snapshot(): BufferSnapshot {
    return {
      islands: this.islands.clone(),
      pendingCapitalization: this._pendingCapitalization,
    };
  }

  save(groupOrOptions?: string | HistorySaveOptions): void {
    const options =
      typeof groupOrOptions === "string"
        ? { group: groupOrOptions }
        : (groupOrOptions ?? {});
    const { group, piecemealCursorIndex } = options;
    if (
      group &&
      this.history.length > 0 &&
      this.history[this.history.length - 1].group === group
    ) {
      return;
    }
    const snap = this.snapshot();
    this.history.push({
      ...snap,
      group,
      ...(piecemealCursorIndex === undefined ? {} : { piecemealCursorIndex }),
    });
  }

  undo(): HistoryFrameFields | null {
    const snap = this.history.pop();
    if (!snap) return null;
    this.islands = snap.islands.clone();
    this._pendingCapitalization = snap.pendingCapitalization;
    return snap.piecemealCursorIndex === undefined
      ? {}
      : { piecemealCursorIndex: snap.piecemealCursorIndex };
  }

  appendVietnamese(text: string, meta: Partial<Island> = {}): void {
    this.save();
    const value = this.applyCapitalization(text);
    this.islands.append(createIsland("vietnamese", value, false, meta));
  }

  appendV7(code: string): void {
    this.save();
    this.islands.append(createIsland("vietnamese", code, true));
  }

  appendSpacing(value: string): void {
    this.save();
    this.islands.append(createIsland("spacing", value));
  }

  appendPunctuation(value: string): void {
    this.save();
    this.islands.append(createIsland("punctuation", value));
  }

  appendCapital(value: string): void {
    this.save();
    this.islands.append(createIsland("capital", value));
  }

  replaceWithText(text: string, meta: Partial<Island> = {}): void {
    this.save();
    this.islands = Rope.fromArray(
      [createIsland("vietnamese", text, false, meta)],
      () => 1,
    );
    this._pendingCapitalization = false;
  }

  private applyCapitalization(text: string): string {
    if (this._pendingCapitalization && text.length > 0) {
      this._pendingCapitalization = false;
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    return text;
  }
}
