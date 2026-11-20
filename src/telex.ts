import { getValidVietnameseSyllables } from "./vietnameseSyllables";

/** Classic UniKey-like Telex or the newer "Simple Telex" key set. */
export type TelexMode = "standard" | "simple";

/** The five Vietnamese lexical tones entered by Telex tone keys. */
export type TelexTone = "acute" | "grave" | "hook" | "tilde" | "dot";

export type TonePlacementSource =
  "v7-broad-exact" | "v7-broad-signature" | "mechanical" | "none";

export type TonePlacement = {
  /** Unicode-code-point index in the supplied NFC string. */
  index: number | null;
  source: TonePlacementSource;
};

export type TelexOptions = {
  /**
   * "standard": W may stand for ư and [ / ] ({ / }) are shortcuts for ơ / ư (Ơ / Ư).
   * "simple": W only modifies a preceding A/O/U and [ / ] / { / } are literal.
   */
  mode?: TelexMode;

  /**
   * Permit shape commands after a coda, e.g. `duongwfd` -> `đường`, `namw` -> `năm`,
   * `vietej` -> `việt`. Enabled by default to match standard Vietnamese Telex IMEs.
   */
  freeShapeMarks?: boolean;
};

export const DEFAULT_TELEX_OPTIONS: Readonly<Required<TelexOptions>> = {
  mode: "standard",
  freeShapeMarks: true,
};

const TONE_BY_KEY: Readonly<Record<string, TelexTone>> = {
  s: "acute",
  f: "grave",
  r: "hook",
  x: "tilde",
  j: "dot",
};

const COMBINING_MARK_BY_TONE: Readonly<Record<TelexTone, string>> = {
  acute: "\u0301",
  grave: "\u0300",
  hook: "\u0309",
  tilde: "\u0303",
  dot: "\u0323",
};

const TONE_BY_COMBINING_MARK: Readonly<Record<string, TelexTone | undefined>> =
  {
    "\u0301": "acute",
    "\u0300": "grave",
    "\u0309": "hook",
    "\u0303": "tilde",
    "\u0323": "dot",
  };

const TONE_MARK_RE = /[\u0300\u0301\u0303\u0309\u0323]/g;
const LETTER_RE = /^\p{L}$/u;
const VIETNAMESE_VOWEL_BASES = new Set([
  "a",
  "ă",
  "â",
  "e",
  "ê",
  "i",
  "o",
  "ô",
  "ơ",
  "u",
  "ư",
  "y",
]);
const SHAPED_VOWELS = new Set(["ă", "â", "ê", "ô", "ơ", "ư"]);
const VALID_VIETNAMESE_CODAS = new Set([
  "",
  "c",
  "ch",
  "m",
  "n",
  "ng",
  "nh",
  "p",
  "t",
]);

const IMMEDIATE_SHAPE: Readonly<Record<string, string>> = {
  a: "â",
  e: "ê",
  o: "ô",
  d: "đ",
};

const REVERSE_IMMEDIATE_SHAPE: Readonly<Record<string, string>> = {
  â: "a",
  ê: "e",
  ô: "o",
  đ: "d",
};

const W_SHAPE: Readonly<Record<string, string>> = {
  a: "ă",
  o: "ơ",
  u: "ư",
};

const REVERSE_W_SHAPE: Readonly<Record<string, string>> = {
  ă: "a",
  ơ: "o",
  ư: "u",
};

/** Cross-mark conversions when the user switches shape mark (e.g. â+w -> ă, ă+a -> â). */
const W_SWITCH_SHAPE: Readonly<Record<string, string>> = {
  â: "ă",
  ô: "ơ",
};

const DOUBLE_SWITCH_SHAPE: Readonly<
  Record<string, { from: string; to: string }>
> = {
  a: { from: "ă", to: "â" },
  o: { from: "ơ", to: "ô" },
};

const STANDARD_SHORTCUT_BY_CHAR: Readonly<Record<string, string>> = {
  "[": "ơ",
  "]": "ư",
  "{": "Ơ",
  "}": "Ư",
};

/** Open syllables where `uo` + `w` should produce `uơ` first and upgrade to `ươ` if a valid ending follows. */
const PENDING_UO_OPEN_BASES = new Set(["thuo", "huo", "khuo"]);

type NucleusDescription = {
  positions: number[];
  vowels: string;
  coda: string;
  onsetClass: "qu" | "gi" | "other";
  runCount: number;
};

type LearnedMap = Map<string, number | null>;

type ToneOracle = {
  exactCarrier: Map<string, number>;
  tonelessSyllables: Set<string>;
  signatureExact: LearnedMap;
  signatureClosed: LearnedMap;
  signatureGeneric: LearnedMap;
};

let toneOracle: ToneOracle | null = null;

function optionsWithDefaults(options?: TelexOptions): Required<TelexOptions> {
  return {
    mode: options?.mode ?? DEFAULT_TELEX_OPTIONS.mode,
    freeShapeMarks:
      options?.freeShapeMarks ?? DEFAULT_TELEX_OPTIONS.freeShapeMarks,
  };
}

function lowerVi(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("vi");
}

function isUppercaseLetter(char: string): boolean {
  return char !== char.toLocaleLowerCase("vi");
}

function withCase(source: string, replacementLowercase: string): string {
  return isUppercaseLetter(source)
    ? replacementLowercase.toLocaleUpperCase("vi")
    : replacementLowercase;
}

function stripToneFromChar(char: string): string {
  return char.normalize("NFD").replace(TONE_MARK_RE, "").normalize("NFC");
}

export function stripVietnameseTone(text: string): string {
  return Array.from(text.normalize("NFC"), stripToneFromChar)
    .join("")
    .normalize("NFC");
}

function toneOfChar(char: string): TelexTone | null {
  for (const mark of Array.from(char.normalize("NFD"))) {
    const tone = TONE_BY_COMBINING_MARK[mark];
    if (tone) return tone;
  }
  return null;
}

function applyToneToChar(char: string, tone: TelexTone): string {
  const untone = stripToneFromChar(char).normalize("NFD");
  return (untone + COMBINING_MARK_BY_TONE[tone]).normalize("NFC");
}

function normalizedVowel(char: string): string | null {
  const lower = stripToneFromChar(char).toLocaleLowerCase("vi");
  return VIETNAMESE_VOWEL_BASES.has(lower) ? lower : null;
}

function isVowel(char: string): boolean {
  return normalizedVowel(char) !== null;
}

function describeNucleus(text: string): NucleusDescription | null {
  const chars = Array.from(lowerVi(stripVietnameseTone(text)));
  if (chars.length === 0) return null;

  const allVowels: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (isVowel(chars[i])) allVowels.push(i);
  }
  if (allVowels.length === 0) return null;

  let onsetClass: NucleusDescription["onsetClass"] = "other";
  const ignored = new Set<number>();

  if (
    chars.length >= 3 &&
    chars[0] === "q" &&
    stripToneFromChar(chars[1]) === "u" &&
    allVowels.some((position) => position > 1)
  ) {
    onsetClass = "qu";
    ignored.add(1);
  } else if (
    chars.length >= 3 &&
    chars[0] === "g" &&
    stripToneFromChar(chars[1]) === "i" &&
    allVowels.some((position) => position > 1)
  ) {
    onsetClass = "gi";
    ignored.add(1);
  }

  const positions = allVowels.filter((position) => !ignored.has(position));
  if (positions.length === 0) return null;

  let runCount = 1;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] !== positions[i - 1] + 1) runCount += 1;
  }

  const last = positions[positions.length - 1];
  return {
    positions,
    vowels: positions.map((position) => chars[position]).join(""),
    coda: chars.slice(last + 1).join(""),
    onsetClass,
    runCount,
  };
}

function lastNucleusRun(description: NucleusDescription): NucleusDescription {
  if (description.runCount <= 1) return description;

  let start = description.positions.length - 1;
  while (
    start > 0 &&
    description.positions[start] === description.positions[start - 1] + 1
  ) {
    start -= 1;
  }

  const positions = description.positions.slice(start);
  const vowelOffset = start;
  return {
    positions,
    vowels: Array.from(description.vowels).slice(vowelOffset).join(""),
    coda: description.coda,
    onsetClass: "other",
    runCount: 1,
  };
}

function signatureKeyExact(description: NucleusDescription): string {
  return `${description.onsetClass}|${description.vowels}|${description.coda}`;
}

function signatureKeyClosed(description: NucleusDescription): string {
  return `${description.onsetClass}|${description.vowels}|${
    description.coda.length === 0 ? "open" : "closed"
  }`;
}

function signatureKeyGeneric(description: NucleusDescription): string {
  return `${description.onsetClass}|${description.vowels}`;
}

function addLearned(map: LearnedMap, key: string, value: number): void {
  const current = map.get(key);
  if (current === undefined) {
    map.set(key, value);
    return;
  }
  if (current !== value) map.set(key, null);
}

function toneCarrierInSurfaceWord(word: string): number | null {
  const chars = Array.from(word.normalize("NFC"));
  let found: number | null = null;
  for (let i = 0; i < chars.length; i++) {
    if (toneOfChar(chars[i]) === null) continue;
    if (found !== null) return null;
    found = i;
  }
  return found;
}

function buildToneOracle(): ToneOracle {
  const exactCarrier = new Map<string, number>();
  const conflictedExact = new Set<string>();
  const tonelessSyllables = new Set<string>();
  const signatureExact: LearnedMap = new Map();
  const signatureClosed: LearnedMap = new Map();
  const signatureGeneric: LearnedMap = new Map();

  for (const syllable of getValidVietnameseSyllables()) {
    const normalized = lowerVi(syllable);
    const plain = lowerVi(stripVietnameseTone(normalized));
    tonelessSyllables.add(plain);

    const carrier = toneCarrierInSurfaceWord(normalized);
    if (carrier === null) continue;

    const existing = exactCarrier.get(plain);
    if (existing === undefined && !conflictedExact.has(plain)) {
      exactCarrier.set(plain, carrier);
    } else if (existing !== carrier) {
      exactCarrier.delete(plain);
      conflictedExact.add(plain);
    }
  }

  for (const [plain, carrier] of exactCarrier) {
    const description = describeNucleus(plain);
    if (!description || description.runCount !== 1) continue;
    const relativeCarrier = description.positions.indexOf(carrier);
    if (relativeCarrier < 0) continue;

    addLearned(signatureExact, signatureKeyExact(description), relativeCarrier);
    addLearned(
      signatureClosed,
      signatureKeyClosed(description),
      relativeCarrier,
    );
    addLearned(
      signatureGeneric,
      signatureKeyGeneric(description),
      relativeCarrier,
    );
  }

  return {
    exactCarrier,
    tonelessSyllables,
    signatureExact,
    signatureClosed,
    signatureGeneric,
  };
}

function getToneOracle(): ToneOracle {
  if (!toneOracle) toneOracle = buildToneOracle();
  return toneOracle;
}

function learnedCarrier(
  description: NucleusDescription,
  oracle: ToneOracle,
): number | null {
  const candidates = [
    oracle.signatureExact.get(signatureKeyExact(description)),
    oracle.signatureClosed.get(signatureKeyClosed(description)),
    oracle.signatureGeneric.get(signatureKeyGeneric(description)),
  ];

  for (const relative of candidates) {
    if (relative === undefined || relative === null) continue;
    return description.positions[relative] ?? null;
  }
  return null;
}

function mechanicalCarrier(description: NucleusDescription): number | null {
  if (description.positions.length === 0) return null;

  for (let i = description.positions.length - 1; i >= 0; i--) {
    const vowel = description.vowels[i];
    if (SHAPED_VOWELS.has(vowel)) return description.positions[i];
  }
  return description.positions[description.positions.length - 1];
}

/**
 * Locate the tone-bearing vowel without requiring the text to be a valid
 * Vietnamese syllable.
 *
 * The lookup order is:
 *   1. exact broad-syllable behavior generated by the existing V7 API;
 *   2. an unambiguous rime signature learned from that same generated set;
 *   3. a documented mechanical fallback for a single contiguous nucleus.
 *
 * If an invalid token contains multiple disconnected vowel runs, fallback
 * behavior is deliberately local: only the last run is considered. This
 * mirrors active-composition behavior and keeps malformed/foreign words
 * deterministic without pretending the whole token is one Vietnamese syllable.
 */
export function findTelexToneCarrier(text: string): TonePlacement {
  const normalized = lowerVi(stripVietnameseTone(text));
  const oracle = getToneOracle();

  const exact = oracle.exactCarrier.get(normalized);
  if (exact !== undefined) {
    return { index: exact, source: "v7-broad-exact" };
  }

  const described = describeNucleus(normalized);
  if (!described) {
    return { index: null, source: "none" };
  }
  const description = lastNucleusRun(described);

  const learned = learnedCarrier(description, oracle);
  if (learned !== null) {
    return { index: learned, source: "v7-broad-signature" };
  }

  const mechanical = mechanicalCarrier(description);
  return mechanical === null
    ? { index: null, source: "none" }
    : { index: mechanical, source: "mechanical" };
}

/** Apply a tone to the carrier selected by findTelexToneCarrier(). */
export function applyTelexTone(text: string, tone: TelexTone): string {
  const normalized = stripVietnameseTone(text).normalize("NFC");
  const chars = Array.from(normalized);
  const placement = findTelexToneCarrier(normalized);
  if (placement.index === null) return normalized;
  chars[placement.index] = applyToneToChar(chars[placement.index], tone);
  return chars.join("").normalize("NFC");
}

type CoreState = {
  letters: string[];
  activeStart: number;
  tone: TelexTone | null;
  toneAnchor: number | null;
  /** True only for the temporary open `thuo`/`huo`/`khuo` + W -> `...uơ` state. */
  pendingUoCompletion: boolean;
};

type CommandGroup = {
  key: string;
  before: CoreState;
};

type MutableState = CoreState & {
  commandGroup: CommandGroup | null;
};

function createEmptyState(): MutableState {
  return {
    letters: [],
    activeStart: 0,
    tone: null,
    toneAnchor: null,
    pendingUoCompletion: false,
    commandGroup: null,
  };
}

function hydrateStateFromToken(text: string): MutableState {
  const state = createEmptyState();
  const chars = Array.from(text.normalize("NFC"));
  let foundTone: TelexTone | null = null;
  let foundAnchor: number | null = null;

  for (let i = 0; i < chars.length; i++) {
    const tone = toneOfChar(chars[i]);
    if (tone !== null) {
      foundTone = tone;
      foundAnchor = i;
      state.letters.push(stripToneFromChar(chars[i]));
    } else {
      state.letters.push(chars[i]);
    }
  }

  state.tone = foundTone;
  state.toneAnchor = foundAnchor;
  return state;
}

function cloneCoreState(state: CoreState): CoreState {
  return {
    letters: [...state.letters],
    activeStart: state.activeStart,
    tone: state.tone,
    toneAnchor: state.toneAnchor,
    pendingUoCompletion: state.pendingUoCompletion,
  };
}

function restoreCoreState(state: MutableState, snapshot: CoreState): void {
  state.letters = [...snapshot.letters];
  state.activeStart = snapshot.activeStart;
  state.tone = snapshot.tone;
  state.toneAnchor = snapshot.toneAnchor;
  state.pendingUoCompletion = snapshot.pendingUoCompletion;
}

function activeText(state: CoreState): string {
  return state.letters.slice(state.activeStart).join("").normalize("NFC");
}

function refreshToneAnchor(state: MutableState): void {
  if (state.tone === null) {
    state.toneAnchor = null;
    return;
  }

  const active = activeText(state);
  const described = describeNucleus(active);

  // If the active token has split into multiple disconnected vowel runs
  // (e.g. "syte" while typing "system"), never teleport an existing tone
  // across a consonant onto a later vowel run.
  if (
    described &&
    described.runCount > 1 &&
    state.toneAnchor !== null &&
    state.toneAnchor >= state.activeStart &&
    state.toneAnchor < state.letters.length &&
    isVowel(state.letters[state.toneAnchor])
  ) {
    return;
  }

  const placement = findTelexToneCarrier(active);
  if (placement.index !== null) {
    state.toneAnchor = state.activeStart + placement.index;
    return;
  }

  if (
    state.toneAnchor !== null &&
    state.toneAnchor >= state.activeStart &&
    state.toneAnchor < state.letters.length &&
    isVowel(state.letters[state.toneAnchor])
  ) {
    return;
  }

  state.toneAnchor = null;
}

function commitTone(state: MutableState): void {
  if (
    state.tone !== null &&
    state.toneAnchor !== null &&
    state.toneAnchor >= 0 &&
    state.toneAnchor < state.letters.length
  ) {
    state.letters[state.toneAnchor] = applyToneToChar(
      state.letters[state.toneAnchor],
      state.tone,
    );
  }
  state.tone = null;
  state.toneAnchor = null;
}

function completePendingUoAfterAppend(state: MutableState): void {
  if (!state.pendingUoCompletion) return;

  // The special open state (`thuơ`, `huơ`, `khuơ`) survives tone commands,
  // but the first ordinary character after it decides whether the pending UƠ
  // nucleus upgrades to ƯƠ (e.g. `thương`, `thước`, `hươu`, `hương`).
  state.pendingUoCompletion = false;

  const described = describeNucleus(activeText(state));
  if (!described || described.runCount !== 1) {
    return;
  }

  const positions = described.positions.map(
    (position) => state.activeStart + position,
  );
  if (positions.length < 2) return;

  // Find the adjacent `uơ` (or `ưo`) pair inside the nucleus (handles both
  // consonant codas like `thươn`/`thươc` and vowel glides like `hươu`/`thươi`).
  let pairIndex = -1;
  for (let i = 0; i < positions.length - 1; i++) {
    const leftPos = positions[i];
    const rightPos = positions[i + 1];
    if (rightPos !== leftPos + 1) continue;
    const left = stripToneFromChar(state.letters[leftPos]).toLocaleLowerCase(
      "vi",
    );
    const right = stripToneFromChar(state.letters[rightPos]).toLocaleLowerCase(
      "vi",
    );
    if ((left === "u" && right === "ơ") || (left === "ư" && right === "o")) {
      pairIndex = i;
      break;
    }
  }
  if (pairIndex < 0) return;

  const leftPos = positions[pairIndex];
  const rightPos = positions[pairIndex + 1];
  const candidate = [...state.letters];
  candidate[leftPos] = withCase(candidate[leftPos], "ư");
  candidate[rightPos] = withCase(candidate[rightPos], "ơ");
  const candidateActive = lowerVi(
    stripVietnameseTone(candidate.slice(state.activeStart).join("")),
  );

  if (!getToneOracle().tonelessSyllables.has(candidateActive)) return;

  state.letters[leftPos] = candidate[leftPos];
  state.letters[rightPos] = candidate[rightPos];
}

function appendOrdinary(state: MutableState, char: string): void {
  state.letters.push(char.normalize("NFC"));
  state.commandGroup = null;
  completePendingUoAfterAppend(state);
  refreshToneAnchor(state);
}

function appendEscapedLiteral(state: MutableState, char: string): void {
  commitTone(state);
  state.letters.push(char.normalize("NFC"));
  // A repeated-mark escape is an explicit declaration that the key is
  // literal. Future Telex commands do not reach back across it.
  state.activeStart = state.letters.length;
  state.pendingUoCompletion = false;
  state.commandGroup = null;
}

function renderState(state: CoreState): string {
  const letters = [...state.letters];
  if (
    state.tone !== null &&
    state.toneAnchor !== null &&
    state.toneAnchor >= 0 &&
    state.toneAnchor < letters.length
  ) {
    letters[state.toneAnchor] = applyToneToChar(
      letters[state.toneAnchor],
      state.tone,
    );
  }
  return letters.join("").normalize("NFC");
}

function beginOrContinueGroup(
  state: MutableState,
  key: string,
  beforeCurrentCommand: CoreState,
): void {
  if (state.commandGroup?.key === key) return;
  state.commandGroup = { key, before: beforeCurrentCommand };
}

function escapeRepeatedCommand(state: MutableState, rawChar: string): void {
  const group = state.commandGroup;
  if (!group) {
    appendOrdinary(state, rawChar);
    return;
  }
  restoreCoreState(state, group.before);
  appendEscapedLiteral(state, rawChar);
}

function replaceLetterWithCase(
  state: MutableState,
  index: number,
  replacementLowercase: string,
): void {
  state.letters[index] = withCase(
    stripToneFromChar(state.letters[index]),
    replacementLowercase,
  );
  refreshToneAnchor(state);
}

function isPlainLetter(char: string, expectedLowercase: string): boolean {
  return stripToneFromChar(char).toLocaleLowerCase("vi") === expectedLowercase;
}

function regionCandidateText(
  state: CoreState,
  changedIndex: number,
  replacementLowercase: string,
): string {
  const copy = [...state.letters];
  copy[changedIndex] = withCase(
    stripToneFromChar(copy[changedIndex]),
    replacementLowercase,
  );
  return copy.slice(state.activeStart).join("").normalize("NFC");
}

function scoreShapeCandidate(text: string): number {
  const oracle = getToneOracle();
  const lower = lowerVi(stripVietnameseTone(text));
  if (oracle.tonelessSyllables.has(lower)) return 10_000;

  const placement = findTelexToneCarrier(lower);
  if (placement.source === "v7-broad-signature") return 1_000;
  if (placement.source === "mechanical") return 100;
  return 0;
}

function hasValidDelayedSyllableShape(state: CoreState): {
  described: NucleusDescription | null;
  hasCoda: boolean;
  valid: boolean;
} {
  const active = activeText(state);
  const described = describeNucleus(active);
  if (!described) {
    return { described: null, hasCoda: false, valid: false };
  }
  if (described.runCount !== 1) {
    return { described, hasCoda: described.coda.length > 0, valid: false };
  }
  if (!VALID_VIETNAMESE_CODAS.has(described.coda)) {
    return { described, hasCoda: described.coda.length > 0, valid: false };
  }
  return { described, hasCoda: described.coda.length > 0, valid: true };
}

function tryImmediateDoubleShape(state: MutableState, key: string): boolean {
  const replacement = IMMEDIATE_SHAPE[key];
  if (!replacement) return false;
  if (state.letters.length <= state.activeStart) return false;

  const index = state.letters.length - 1;
  if (isPlainLetter(state.letters[index], key)) {
    replaceLetterWithCase(state, index, replacement);
    return true;
  }

  // Allow switching `ă` + `a` -> `â` or `ơ` + `o` -> `ô`.
  const switchSpec = DOUBLE_SWITCH_SHAPE[key];
  if (switchSpec && isPlainLetter(state.letters[index], switchSpec.from)) {
    replaceLetterWithCase(state, index, switchSpec.to);
    return true;
  }

  return false;
}

function tryDelayedShape(
  state: MutableState,
  key: string,
  options: Required<TelexOptions>,
): boolean {
  const replacement = IMMEDIATE_SHAPE[key];
  if (!replacement || state.letters.length <= state.activeStart) return false;

  const shapeCheck = hasValidDelayedSyllableShape(state);
  if (!shapeCheck.valid) return false;

  if (key === "d") {
    if (!options.freeShapeMarks) return false;
    const index = state.activeStart;
    if (!isPlainLetter(state.letters[index], "d")) return false;
    if (index >= state.letters.length - 1) return false;
    replaceLetterWithCase(state, index, replacement);
    return true;
  }

  // Post-coda delayed shape requires `freeShapeMarks`; nucleus-internal shapes
  // like `toio` -> `tôi`, `caua` -> `câu`, `caya` -> `cây`, `tieue` -> `tiêu`
  // have no coda and work in both modes.
  if (shapeCheck.hasCoda && !options.freeShapeMarks) return false;

  const switchSpec = DOUBLE_SWITCH_SHAPE[key];
  const candidates: Array<{ index: number; to: string; score: number }> = [];
  for (
    let index = state.activeStart;
    index < state.letters.length - 1;
    index++
  ) {
    if (isPlainLetter(state.letters[index], key)) {
      candidates.push({
        index,
        to: replacement,
        score: scoreShapeCandidate(
          regionCandidateText(state, index, replacement),
        ),
      });
    } else if (
      switchSpec &&
      isPlainLetter(state.letters[index], switchSpec.from)
    ) {
      candidates.push({
        index,
        to: switchSpec.to,
        score: scoreShapeCandidate(
          regionCandidateText(state, index, switchSpec.to),
        ),
      });
    }
  }
  if (candidates.length === 0) return false;

  candidates.sort((a, b) => b.score - a.score || b.index - a.index);
  replaceLetterWithCase(state, candidates[0].index, candidates[0].to);
  return true;
}

function tryUndoActiveDoubleShape(
  state: MutableState,
  key: string,
  rawChar: string,
  options: Required<TelexOptions>,
): boolean {
  const shaped = IMMEDIATE_SHAPE[key];
  if (!shaped || state.letters.length <= state.activeStart) return false;

  if (key === "d") {
    const index = state.activeStart;
    if (!isPlainLetter(state.letters[index], "đ")) return false;
    if (index < state.letters.length - 1) {
      const check = hasValidDelayedSyllableShape(state);
      if (!options.freeShapeMarks || !check.valid) return false;
    }
    replaceLetterWithCase(state, index, "d");
    appendEscapedLiteral(state, rawChar);
    return true;
  }

  const check = hasValidDelayedSyllableShape(state);
  if (!check.valid || !check.described) return false;
  if (check.hasCoda && !options.freeShapeMarks) return false;

  for (let i = check.described.positions.length - 1; i >= 0; i--) {
    const pos = state.activeStart + check.described.positions[i];
    if (isPlainLetter(state.letters[pos], shaped)) {
      replaceLetterWithCase(state, pos, REVERSE_IMMEDIATE_SHAPE[shaped]);
      appendEscapedLiteral(state, rawChar);
      return true;
    }
  }
  return false;
}

function eligibleWPositions(state: CoreState): {
  positions: number[];
  switchPositions: number[];
  hasCoda: boolean;
  validCoda: boolean;
  runCount: number;
} | null {
  const region = state.letters.slice(state.activeStart);
  const described = describeNucleus(region.join(""));
  if (!described) return null;
  const description = lastNucleusRun(described);

  const positions: number[] = [];
  const switchPositions: number[] = [];

  for (const relPos of description.positions) {
    const position = state.activeStart + relPos;
    const plain = stripToneFromChar(state.letters[position]).toLocaleLowerCase(
      "vi",
    );
    if (W_SHAPE[plain] !== undefined) {
      positions.push(position);
    } else if (W_SWITCH_SHAPE[plain] !== undefined) {
      switchPositions.push(position);
    }
  }

  if (positions.length === 0 && switchPositions.length === 0) return null;
  const lastNucleusPosition =
    state.activeStart + description.positions[description.positions.length - 1];
  return {
    positions,
    switchPositions,
    hasCoda: lastNucleusPosition < state.letters.length - 1,
    validCoda: VALID_VIETNAMESE_CODAS.has(description.coda),
    runCount: described.runCount,
  };
}

function tryWShape(
  state: MutableState,
  options: Required<TelexOptions>,
  allowStandalone: boolean,
  standaloneSource = "w",
): boolean {
  const eligible = eligibleWPositions(state);

  if (eligible) {
    if (eligible.hasCoda && (!options.freeShapeMarks || !eligible.validCoda)) {
      return false;
    }
    if (eligible.hasCoda && eligible.runCount > 1) {
      return false;
    }

    if (eligible.positions.length > 0) {
      // 1. Check for an adjacent `u` + `o` pair anywhere in the active nucleus
      //    (handles `uo`, `uoi`, `uou` like `rượu`/`hươu`, `uong`, `uoc`, etc.).
      for (let i = eligible.positions.length - 2; i >= 0; i--) {
        const left = eligible.positions[i];
        const right = eligible.positions[i + 1];
        if (right !== left + 1) continue;
        const leftBase = stripToneFromChar(
          state.letters[left],
        ).toLocaleLowerCase("vi");
        const rightBase = stripToneFromChar(
          state.letters[right],
        ).toLocaleLowerCase("vi");

        if (leftBase === "u" && rightBase === "o") {
          const activePlain = lowerVi(stripVietnameseTone(activeText(state)));
          if (!eligible.hasCoda && PENDING_UO_OPEN_BASES.has(activePlain)) {
            replaceLetterWithCase(state, right, "ơ");
            state.pendingUoCompletion = true;
            return true;
          }

          replaceLetterWithCase(state, left, "ư");
          replaceLetterWithCase(state, right, "ơ");
          state.pendingUoCompletion = false;
          return true;
        }
      }

      // 2. Check for adjacent `u` + `a` (`mưa`, `cưa`, `chưa`, `nữa`) or
      //    adjacent `u` + `u` (`lưu`, `cứu`, `hữu`). In both cases, `u` (the
      //    first vowel) takes the horn, never `a` or the second `u`.
      //    Note: `qu` onset `u` is already excluded by describeNucleus(), so
      //    `quaw` only has `a` in eligible.positions and still produces `quă`.
      for (let i = eligible.positions.length - 2; i >= 0; i--) {
        const left = eligible.positions[i];
        const right = eligible.positions[i + 1];
        if (right !== left + 1) continue;
        const leftBase = stripToneFromChar(
          state.letters[left],
        ).toLocaleLowerCase("vi");
        const rightBase = stripToneFromChar(
          state.letters[right],
        ).toLocaleLowerCase("vi");

        if (leftBase === "u" && (rightBase === "a" || rightBase === "u")) {
          replaceLetterWithCase(state, left, "ư");
          state.pendingUoCompletion = false;
          return true;
        }
      }

      // 3. Otherwise transform the rightmost eligible vowel (`oă` from `oa`,
      //    single `a`/`o`/`u` -> `ă`/`ơ`/`ư`).
      const index = eligible.positions[eligible.positions.length - 1];
      const base = stripToneFromChar(state.letters[index]).toLocaleLowerCase(
        "vi",
      );
      const replacement = W_SHAPE[base];
      if (replacement) {
        replaceLetterWithCase(state, index, replacement);
        state.pendingUoCompletion = false;
        return true;
      }
    }

    // 4. Switch circumflex to breve/horn (`â` + `w` -> `ă`, `ô` + `w` -> `ơ`).
    if (eligible.switchPositions.length > 0) {
      const index =
        eligible.switchPositions[eligible.switchPositions.length - 1];
      const base = stripToneFromChar(state.letters[index]).toLocaleLowerCase(
        "vi",
      );
      const replacement = W_SWITCH_SHAPE[base];
      if (replacement) {
        replaceLetterWithCase(state, index, replacement);
        state.pendingUoCompletion = false;
        return true;
      }
    }
  }

  if (!allowStandalone || options.mode !== "standard") return false;

  const description = describeNucleus(activeText(state));
  if (description !== null) return false;

  state.letters.push(withCase(standaloneSource, "ư"));
  state.pendingUoCompletion = false;
  refreshToneAnchor(state);
  return true;
}

function tryUndoActiveWShape(
  state: MutableState,
  rawChar: string,
  options: Required<TelexOptions>,
): boolean {
  const check = hasValidDelayedSyllableShape(state);
  if (!check.valid || !check.described) return false;
  if (check.hasCoda && !options.freeShapeMarks) return false;

  const positions = check.described.positions.map(
    (position) => state.activeStart + position,
  );

  // Undo `ươ` pair together back to `uo`.
  for (let i = positions.length - 2; i >= 0; i--) {
    const left = positions[i];
    const right = positions[i + 1];
    if (right !== left + 1) continue;
    const leftBase = stripToneFromChar(state.letters[left]).toLocaleLowerCase(
      "vi",
    );
    const rightBase = stripToneFromChar(state.letters[right]).toLocaleLowerCase(
      "vi",
    );
    if (leftBase === "ư" && rightBase === "ơ") {
      replaceLetterWithCase(state, left, "u");
      replaceLetterWithCase(state, right, "o");
      appendEscapedLiteral(state, rawChar);
      return true;
    }
  }

  for (let i = positions.length - 1; i >= 0; i--) {
    const pos = positions[i];
    const base = stripToneFromChar(state.letters[pos]).toLocaleLowerCase("vi");
    const plain = REVERSE_W_SHAPE[base];
    if (plain) {
      replaceLetterWithCase(state, pos, plain);
      appendEscapedLiteral(state, rawChar);
      return true;
    }
  }
  return false;
}

function tryToneCommand(state: MutableState, tone: TelexTone): boolean {
  const placement = findTelexToneCarrier(activeText(state));
  if (placement.index === null) {
    if (
      state.tone !== null &&
      state.toneAnchor !== null &&
      state.toneAnchor >= state.activeStart
    ) {
      state.tone = tone;
      return true;
    }
    return false;
  }

  state.tone = tone;
  state.toneAnchor = state.activeStart + placement.index;
  return true;
}

function tryClearTone(state: MutableState): boolean {
  if (state.tone === null) return false;
  state.tone = null;
  state.toneAnchor = null;
  return true;
}

function processStandardShortcut(
  state: MutableState,
  rawChar: string,
): boolean {
  const shortcutVowel = STANDARD_SHORTCUT_BY_CHAR[rawChar];
  if (!shortcutVowel) return false;

  const groupKey = `shortcut:${rawChar}`;
  if (state.commandGroup?.key === groupKey) {
    escapeRepeatedCommand(state, rawChar);
    return true;
  }

  const before = cloneCoreState(state);
  state.letters.push(shortcutVowel);
  state.pendingUoCompletion = false;
  refreshToneAnchor(state);
  beginOrContinueGroup(state, groupKey, before);
  return true;
}

function stepState(
  state: MutableState,
  rawChar: string,
  options: Required<TelexOptions>,
): void {
  if (options.mode === "standard" && processStandardShortcut(state, rawChar)) {
    return;
  }

  const key = rawChar.toLocaleLowerCase("en-US");

  const tone = TONE_BY_KEY[key];
  if (tone) {
    // Pressing the same tone key that is already active on this word — whether
    // immediately (`cass` -> `cas`, `casff` -> `caf`) or later in the word
    // (`cases` -> `cases`, `server` -> `server`) — clears the tone and outputs
    // the literal key.
    if (state.tone === tone) {
      state.tone = null;
      state.toneAnchor = null;
      appendEscapedLiteral(state, rawChar);
      return;
    }

    const before = cloneCoreState(state);
    if (tryToneCommand(state, tone)) {
      beginOrContinueGroup(state, key, before);
    } else {
      appendOrdinary(state, rawChar);
    }
    return;
  }

  if (key === "z") {
    // Z is Telex tone zero, not "remove every mark". If a tone is present it
    // is consumed and cleared. With no tone to clear, Z is an ordinary
    // literal letter.
    state.commandGroup = null;
    if (!tryClearTone(state)) appendOrdinary(state, rawChar);
    return;
  }

  if (key === "w") {
    const sameGroup = state.commandGroup?.key === key;
    if (sameGroup) {
      // A second W can legitimately modify a second vowel (e.g. `thuoww`).
      // Only escape when there is no additional shape operation available.
      if (tryWShape(state, options, false, rawChar)) return;
      escapeRepeatedCommand(state, rawChar);
      return;
    }

    const before = cloneCoreState(state);
    if (tryWShape(state, options, true, rawChar)) {
      beginOrContinueGroup(state, key, before);
      return;
    }
    if (tryUndoActiveWShape(state, rawChar, options)) {
      return;
    }
    appendOrdinary(state, rawChar);
    return;
  }

  if (IMMEDIATE_SHAPE[key] !== undefined) {
    const sameGroup = state.commandGroup?.key === key;
    if (sameGroup) {
      if (tryDelayedShape(state, key, options)) return;
      escapeRepeatedCommand(state, rawChar);
      return;
    }

    const before = cloneCoreState(state);
    if (
      tryImmediateDoubleShape(state, key) ||
      tryDelayedShape(state, key, options)
    ) {
      beginOrContinueGroup(state, key, before);
      return;
    }
    if (tryUndoActiveDoubleShape(state, key, rawChar, options)) {
      return;
    }
    appendOrdinary(state, rawChar);
    return;
  }

  appendOrdinary(state, rawChar);
}

function reduceToken(raw: string, options: Required<TelexOptions>): CoreState {
  const state = createEmptyState();
  for (const rawChar of Array.from(raw.normalize("NFC"))) {
    stepState(state, rawChar, options);
  }
  return state;
}

/** Convert one active, separator-free Telex composition. */
export function convertTelexToken(raw: string, options?: TelexOptions): string {
  const resolved = optionsWithDefaults(options);
  return renderState(reduceToken(raw, resolved));
}

function isTokenCharacter(char: string, mode: TelexMode): boolean {
  if (LETTER_RE.test(char)) return true;
  return (
    mode === "standard" &&
    (char === "[" || char === "]" || char === "{" || char === "}")
  );
}

/**
 * Convenience conversion for arbitrary text. Non-letter separators are copied
 * verbatim and independently terminate Telex composition regions.
 */
export function convertTelex(input: string, options?: TelexOptions): string {
  const resolved = optionsWithDefaults(options);
  let result = "";
  let token = "";

  const flush = () => {
    if (token.length === 0) return;
    result += convertTelexToken(token, resolved);
    token = "";
  };

  for (const char of Array.from(input.normalize("NFC"))) {
    if (isTokenCharacter(char, resolved.mode)) {
      token += char;
    } else {
      flush();
      result += char;
    }
  }
  flush();
  return result.normalize("NFC");
}

/**
 * Incremental composition helper for an IME/editor integration.
 *
 * Maintains live active-token state so backspace intuitively deletes the last
 * visible character (rather than undoing a prior Telex keystroke) while still
 * keeping tone placement responsive as letters are added or removed.
 */
export class TelexComposer {
  private readonly options: Required<TelexOptions>;
  private committedPrefix = "";
  private activeState: MutableState = createEmptyState();
  private rawBuffer = "";
  private rendered = "";

  constructor(options?: TelexOptions) {
    this.options = optionsWithDefaults(options);
  }

  get raw(): string {
    return this.rawBuffer;
  }

  get text(): string {
    return this.rendered;
  }

  push(key: string): string {
    const chars = Array.from(key.normalize("NFC"));
    if (chars.length !== 1) {
      throw new TypeError("TelexComposer.push() expects exactly one character");
    }
    const char = chars[0];
    this.rawBuffer += char;

    if (isTokenCharacter(char, this.options.mode)) {
      stepState(this.activeState, char, this.options);
    } else {
      if (this.activeState.letters.length > 0) {
        this.committedPrefix += renderState(this.activeState);
        this.activeState = createEmptyState();
      }
      this.committedPrefix += char;
    }

    this.syncRendered();
    return this.rendered;
  }

  backspace(): string {
    if (this.activeState.letters.length > 0) {
      const poppedIndex = this.activeState.letters.length - 1;
      this.activeState.letters.pop();
      this.activeState.commandGroup = null;
      this.activeState.pendingUoCompletion = false;

      if (this.activeState.toneAnchor === poppedIndex) {
        // The deleted character itself carried the tone, so the tone is removed
        // along with the character rather than jumping to another vowel.
        this.activeState.tone = null;
        this.activeState.toneAnchor = null;
      } else {
        refreshToneAnchor(this.activeState);
      }

      if (this.activeState.letters.length < this.activeState.activeStart) {
        // User deleted back across an escaped literal; re-open the remaining
        // token for normal composition without re-applying discarded marks.
        this.activeState = hydrateStateFromToken(renderState(this.activeState));
      }
    } else if (this.committedPrefix.length > 0) {
      const prefixChars = Array.from(this.committedPrefix);
      prefixChars.pop();
      this.committedPrefix = prefixChars.join("");

      // If deleting a separator exposes a preceding word, re-hydrate it as the
      // active token so subsequent edits and tone changes work naturally.
      let splitAt = prefixChars.length;
      while (
        splitAt > 0 &&
        isTokenCharacter(prefixChars[splitAt - 1], this.options.mode)
      ) {
        splitAt -= 1;
      }
      if (splitAt < prefixChars.length) {
        const trailingToken = prefixChars.slice(splitAt).join("");
        this.committedPrefix = prefixChars.slice(0, splitAt).join("");
        this.activeState = hydrateStateFromToken(trailingToken);
      }
    }

    this.syncRendered();
    this.rawBuffer = this.rendered;
    return this.rendered;
  }

  replaceRaw(raw: string): string {
    this.clear();
    for (const char of Array.from(raw.normalize("NFC"))) {
      this.push(char);
    }
    return this.rendered;
  }

  clear(): void {
    this.committedPrefix = "";
    this.activeState = createEmptyState();
    this.rawBuffer = "";
    this.rendered = "";
  }

  commit(): string {
    const text = this.rendered;
    this.clear();
    return text;
  }

  private syncRendered(): void {
    this.rendered = (
      this.committedPrefix + renderState(this.activeState)
    ).normalize("NFC");
  }
}
