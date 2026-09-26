import { Rope } from "./rope";

export type V7Mode = "compositional" | "dictionary";
export type InferenceIsland =
  { kind: "fixed"; text: string } | { kind: "v7"; code: string; mode: V7Mode };

export interface IslandSpacing {
  before: boolean;
  after: boolean;
}
interface TextIslandFields {
  value: string;
  spacing?: IslandSpacing;
}
export type V7Capitalization = "none" | "initial" | "upper";
export type V7Validation = "pending" | "valid" | "invalid";
export type V7Island = TextIslandFields & {
  type: "v7";
  capitalization: V7Capitalization;
  validation: V7Validation;
} & (
    | { mode: "compositional" }
    | { mode: "dictionary"; dictionaryBucketSize?: number }
  );
export type VietnameseIsland = TextIslandFields & { type: "vietnamese" };
export type PloverIsland = TextIslandFields & {
  type: "plover";
  phase: "committed" | "preedit";
};
export interface IslandByType {
  vietnamese: VietnameseIsland;
  v7: V7Island;
  plover: PloverIsland;
  punctuation: TextIslandFields & { type: "punctuation" };
  capital: TextIslandFields & { type: "capital" };
  spacing: TextIslandFields & { type: "spacing" };
  emily: TextIslandFields & { type: "emily" };
  fixed: TextIslandFields & { type: "fixed"; spacing: IslandSpacing };
}
export type IslandType = keyof IslandByType;
export type Island = IslandByType[IslandType];
type SpacingOptions = { spacing?: IslandSpacing };
export type V7IslandOptions = SpacingOptions & {
  capitalization?: V7Capitalization;
  validation?: V7Validation;
} & (
    | { mode?: "compositional" }
    | { mode: "dictionary"; dictionaryBucketSize?: number }
  );
interface IslandOptionsByType {
  vietnamese: SpacingOptions;
  v7: V7IslandOptions;
  plover: SpacingOptions & { phase?: PloverIsland["phase"] };
  punctuation: SpacingOptions;
  capital: SpacingOptions;
  spacing: SpacingOptions;
  emily: SpacingOptions;
  fixed: SpacingOptions;
}

export function isSyllableIsland(
  island: Island,
): island is VietnameseIsland | V7Island | PloverIsland {
  return (
    island.type === "vietnamese" ||
    island.type === "v7" ||
    island.type === "plover"
  );
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

const islandFactories: {
  [K in IslandType]: (
    value: string,
    options: IslandOptionsByType[K],
  ) => IslandByType[K];
} = {
  vietnamese: (value, options) => ({ type: "vietnamese", value, ...options }),
  punctuation: (value, options) => ({ type: "punctuation", value, ...options }),
  capital: (value, options) => ({ type: "capital", value, ...options }),
  spacing: (value, options) => ({ type: "spacing", value, ...options }),
  emily: (value, options) => ({ type: "emily", value, ...options }),
  fixed: (value, options) => ({
    type: "fixed",
    value,
    spacing: options.spacing ?? { before: false, after: false },
  }),
  plover: (value, options) => ({
    type: "plover",
    value,
    ...options,
    phase: options.phase ?? "committed",
  }),
  v7: (value, options) => {
    const fields = {
      type: "v7" as const,
      value,
      ...(options.spacing ? { spacing: options.spacing } : {}),
      capitalization: options.capitalization ?? "none",
      validation: options.validation ?? "pending",
    };
    return options.mode === "dictionary"
      ? {
          ...fields,
          mode: "dictionary",
          ...(options.dictionaryBucketSize === undefined
            ? {}
            : { dictionaryBucketSize: options.dictionaryBucketSize }),
        }
      : { ...fields, mode: "compositional" };
  },
};

type IslandConstructorArguments = {
  [K in IslandType]: [type: K, value: string, options?: IslandOptionsByType[K]];
}[IslandType];

// The complete argument tuple must match one variant. Checking only each
// argument through a generic K would lose this correlation when K is a union.
export function createIsland<K extends IslandType>(
  ...args: [type: K, value: string, options?: IslandOptionsByType[K]] &
    IslandConstructorArguments
): IslandByType[K];
export function createIsland(...args: IslandConstructorArguments): Island {
  const [type, value, options] = args;
  switch (type) {
    case "vietnamese":
      return islandFactories.vietnamese(value, options ?? {});
    case "v7":
      return islandFactories.v7(value, options ?? {});
    case "plover":
      return islandFactories.plover(value, options ?? {});
    case "punctuation":
      return islandFactories.punctuation(value, options ?? {});
    case "capital":
      return islandFactories.capital(value, options ?? {});
    case "spacing":
      return islandFactories.spacing(value, options ?? {});
    case "emily":
      return islandFactories.emily(value, options ?? {});
    case "fixed":
      return islandFactories.fixed(value, options ?? {});
  }
}

export function shouldAddSpace(
  prev: Island | null,
  curr: Island | null,
): boolean {
  if (!prev || !curr) return false;
  if (prev.value === "" && prev.type !== "v7") return false;
  if (prev.type === "spacing" || curr.type === "spacing") return false;

  if (prev.spacing || curr.spacing) {
    if (curr.spacing) {
      return curr.spacing.before;
    }
    return prev.spacing?.after ?? false;
  }

  if (curr.type === "punctuation") return false;
  if (prev.type === "punctuation") return true;

  if (prev.type === "capital") {
    if (curr.type === "capital") return false;
    return true;
  }

  if (isSyllableIsland(prev)) {
    if (isSyllableIsland(curr)) return true;
    if (curr.type === "capital") return true;
  }

  return false;
}

export function convertIslandsForInference(
  islands: Island[],
): InferenceIsland[] {
  const serverIslands: InferenceIsland[] = [];
  let currentFixed = Rope.fromString("");

  for (let i = 0; i < islands.length; i++) {
    const curr = islands[i];

    if (curr.type === "v7") {
      const prev = i > 0 ? islands[i - 1] : null;
      if (prev && shouldAddSpace(prev, curr)) {
        currentFixed.append(" ");
      }
      const chunk = currentFixed.toString();
      serverIslands.push({ kind: "fixed", text: chunk });
      currentFixed = Rope.fromString("");
      serverIslands.push({
        kind: "v7",
        code: curr.value,
        mode: curr.mode,
      });
    } else {
      const prev = i > 0 ? islands[i - 1] : null;
      if (prev && shouldAddSpace(prev, curr)) {
        currentFixed.append(" ");
      }
      currentFixed.append(curr.value);
    }
  }

  serverIslands.push({ kind: "fixed", text: currentFixed.toString() });
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
    this.islands = Rope.fromArray<Island>(seeds, () => 1);
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
    this.islands = Rope.fromArray<Island>(next, () => 1);
  }

  appendIsland(value: Island): void {
    this.islands.append(value);
  }

  trimTrailingSpaceFromLastVietnameseIsland(): boolean {
    const lastIndex = this.islands.length() - 1;
    if (lastIndex < 0) return false;
    const last = this.islands.getAt(lastIndex);
    if (!last || !isSyllableIsland(last) || !last.value.endsWith(" "))
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
    this.islands = Rope.fromArray<Island>(
      [createIsland("vietnamese", "")],
      () => 1,
    );
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

  appendVietnamese(text: string, meta: SpacingOptions = {}): void {
    this.save();
    const value = this.applyCapitalization(text);
    this.islands.append(createIsland("vietnamese", value, meta));
  }

  appendV7(code: string): void {
    this.save();
    this.islands.append(createIsland("v7", code));
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

  replaceWithText(text: string, meta: SpacingOptions = {}): void {
    this.save();
    this.islands = Rope.fromArray<Island>(
      [createIsland("vietnamese", text, meta)],
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
