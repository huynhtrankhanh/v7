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
   * "standard": W may stand for ư and [ / ] are shortcuts for ư / ơ.
   * "simple": W only modifies a preceding A/O/U and [ / ] are literal.
   */
  mode?: TelexMode;

  /**
   * Permit shape commands after a coda, e.g. `duongwwfd` -> `đường`.
   * This is deliberately off by default because it makes ordinary Latin text
   * substantially more ambiguous.
   */
  freeShapeMarks?: boolean;
};

export const DEFAULT_TELEX_OPTIONS: Readonly<Required<TelexOptions>> = {
  mode: "standard",
  freeShapeMarks: false,
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

const IMMEDIATE_SHAPE: Readonly<Record<string, string>> = {
  a: "â",
  e: "ê",
  o: "ô",
  d: "đ",
};

const W_SHAPE: Readonly<Record<string, string>> = {
  a: "ă",
  o: "ơ",
  u: "ư",
};

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

  // Once linguistic evidence runs out, prefer a vowel that already carries a
  // Vietnamese vowel-quality mark. This makes malformed forms containing ă,
  // â, ê, ô, ơ, or ư behave less surprisingly. If several qualify, choose the
  // rightmost one. Otherwise choose the rightmost eligible vowel, full stop.
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
  /** True only for the temporary open `thuo` + W -> `thuơ` state. */
  pendingUoCompletion: boolean;
};

type CommandGroup = {
  key: string;
  before: CoreState;
};

type MutableState = CoreState & {
  commandGroup: CommandGroup | null;
};

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

  const placement = findTelexToneCarrier(activeText(state));
  if (placement.index !== null) {
    state.toneAnchor = state.activeStart + placement.index;
    return;
  }

  // If later input makes the whole active token uninterpretable, retain the
  // last usable anchor rather than making a previously visible tone vanish.
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

  // The special open state survives tone commands, but the first ordinary
  // character after it decides whether the pending UƠ nucleus closes as ƯƠ.
  // Restricting completion to this explicit state avoids rewriting literal
  // precomposed `uơ` text that did not come from the `thuo` + W path.
  state.pendingUoCompletion = false;

  const described = describeNucleus(activeText(state));
  if (!described || described.runCount !== 1 || described.coda.length === 0) {
    return;
  }

  const positions = described.positions.map(
    (position) => state.activeStart + position,
  );
  if (positions.length < 2) return;

  const penultimate = positions[positions.length - 2];
  const last = positions[positions.length - 1];
  if (last !== penultimate + 1) return;

  const left = stripToneFromChar(state.letters[penultimate]).toLocaleLowerCase(
    "vi",
  );
  const right = stripToneFromChar(state.letters[last]).toLocaleLowerCase("vi");
  if (!((left === "u" && right === "ơ") || (left === "ư" && right === "o"))) {
    return;
  }

  const candidate = [...state.letters];
  candidate[penultimate] = withCase(candidate[penultimate], "ư");
  candidate[last] = withCase(candidate[last], "ơ");
  const candidateActive = lowerVi(
    stripVietnameseTone(candidate.slice(state.activeStart).join("")),
  );

  // V7 is the admission oracle. This adapter stores its generated surfaces
  // tone-stripped, so this also admits bases such as `thươc`, even though
  // Vietnamese realizes those stop finals only with sắc or nặng.
  if (!getToneOracle().tonelessSyllables.has(candidateActive)) return;

  state.letters[penultimate] = candidate[penultimate];
  state.letters[last] = candidate[last];
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

function tryImmediateDoubleShape(state: MutableState, key: string): boolean {
  const replacement = IMMEDIATE_SHAPE[key];
  if (!replacement) return false;
  if (state.letters.length <= state.activeStart) return false;

  const index = state.letters.length - 1;
  if (!isPlainLetter(state.letters[index], key)) return false;

  replaceLetterWithCase(state, index, replacement);
  return true;
}

function tryFreeDelayedShape(state: MutableState, key: string): boolean {
  const replacement = IMMEDIATE_SHAPE[key];
  if (!replacement || state.letters.length <= state.activeStart) return false;

  if (key === "d") {
    const index = state.activeStart;
    if (!isPlainLetter(state.letters[index], "d")) return false;
    if (index >= state.letters.length - 1) return false;
    replaceLetterWithCase(state, index, replacement);
    return true;
  }

  const candidates: Array<{ index: number; score: number }> = [];
  for (
    let index = state.activeStart;
    index < state.letters.length - 1;
    index++
  ) {
    if (!isPlainLetter(state.letters[index], key)) continue;
    candidates.push({
      index,
      score: scoreShapeCandidate(
        regionCandidateText(state, index, replacement),
      ),
    });
  }
  if (candidates.length === 0) return false;

  candidates.sort((a, b) => b.score - a.score || b.index - a.index);
  replaceLetterWithCase(state, candidates[0].index, replacement);
  return true;
}

function eligibleWPositions(state: CoreState): {
  positions: number[];
  hasCoda: boolean;
} | null {
  const region = state.letters.slice(state.activeStart);
  const described = describeNucleus(region.join(""));
  if (!described) return null;
  const description = lastNucleusRun(described);

  const positions = description.positions
    .map((position) => state.activeStart + position)
    .filter((position) => {
      const plain = stripToneFromChar(
        state.letters[position],
      ).toLocaleLowerCase("vi");
      return W_SHAPE[plain] !== undefined;
    });

  if (positions.length === 0) return null;
  const lastNucleusPosition =
    state.activeStart + description.positions[description.positions.length - 1];
  return {
    positions,
    hasCoda: lastNucleusPosition < state.letters.length - 1,
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
    if (eligible.hasCoda && !options.freeShapeMarks) return false;

    // Real Telex has one important open-syllable exception. For `thuo` + W,
    // horn only O for now: `thuow` -> `thuơ`. This preserves the normal path
    // to `thuở`. If a valid coda arrives later, appendOrdinary() upgrades the
    // temporary `uơ` nucleus to `ươ` using the V7-derived syllable oracle.
    if (!eligible.hasCoda && eligible.positions.length >= 2) {
      const penultimate = eligible.positions[eligible.positions.length - 2];
      const last = eligible.positions[eligible.positions.length - 1];
      const penultimateBase = stripToneFromChar(
        state.letters[penultimate],
      ).toLocaleLowerCase("vi");
      const lastBase = stripToneFromChar(state.letters[last]).toLocaleLowerCase(
        "vi",
      );
      if (
        last === penultimate + 1 &&
        penultimateBase === "u" &&
        lastBase === "o"
      ) {
        if (lowerVi(stripVietnameseTone(activeText(state))) === "thuo") {
          replaceLetterWithCase(state, last, "ơ");
          state.pendingUoCompletion = true;
          return true;
        }

        // Everywhere else, immediate UO + W is the compact spelling of ƯƠ.
        // This excludes the U of QU because describeNucleus() treats it as an
        // onset glide rather than part of the active nucleus.
        replaceLetterWithCase(state, penultimate, "ư");
        replaceLetterWithCase(state, last, "ơ");
        state.pendingUoCompletion = false;
        return true;
      }
    }

    if (
      eligible.hasCoda &&
      options.freeShapeMarks &&
      eligible.positions.length >= 2
    ) {
      const penultimate = eligible.positions[eligible.positions.length - 2];
      const last = eligible.positions[eligible.positions.length - 1];
      const bases = [penultimate, last].map((position) =>
        stripToneFromChar(state.letters[position]).toLocaleLowerCase("vi"),
      );
      if (last === penultimate + 1 && bases[0] === "u" && bases[1] === "o") {
        replaceLetterWithCase(state, penultimate, "ư");
        replaceLetterWithCase(state, last, "ơ");
        state.pendingUoCompletion = false;
        return true;
      }
    }

    // Otherwise transform the rightmost eligible vowel in the active nucleus.
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

  if (!allowStandalone || options.mode !== "standard") return false;

  const description = describeNucleus(activeText(state));
  if (description !== null) return false;

  state.letters.push(withCase(standaloneSource, "ư"));
  state.pendingUoCompletion = false;
  refreshToneAnchor(state);
  return true;
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
  if (rawChar === "[") {
    state.letters.push("ơ");
    state.pendingUoCompletion = false;
    state.commandGroup = null;
    refreshToneAnchor(state);
    return true;
  }
  if (rawChar === "]") {
    state.letters.push("ư");
    state.pendingUoCompletion = false;
    state.commandGroup = null;
    refreshToneAnchor(state);
    return true;
  }
  return false;
}

function reduceToken(raw: string, options: Required<TelexOptions>): CoreState {
  const state: MutableState = {
    letters: [],
    activeStart: 0,
    tone: null,
    toneAnchor: null,
    pendingUoCompletion: false,
    commandGroup: null,
  };

  for (const rawChar of Array.from(raw.normalize("NFC"))) {
    if (
      options.mode === "standard" &&
      processStandardShortcut(state, rawChar)
    ) {
      continue;
    }

    const key = rawChar.toLocaleLowerCase("en-US");

    const tone = TONE_BY_KEY[key];
    if (tone) {
      if (state.commandGroup?.key === key) {
        escapeRepeatedCommand(state, rawChar);
        continue;
      }

      const before = cloneCoreState(state);
      if (tryToneCommand(state, tone)) {
        beginOrContinueGroup(state, key, before);
      } else {
        appendOrdinary(state, rawChar);
      }
      continue;
    }

    if (key === "z") {
      // Z is Telex tone zero, not "remove every mark". If a tone is present it
      // is consumed and cleared. With no tone to clear, Z is an ordinary
      // literal letter. In particular, a second Z after a successful clear is
      // literal; it must not restore the cleared tone via command-group undo.
      state.commandGroup = null;
      if (!tryClearTone(state)) appendOrdinary(state, rawChar);
      continue;
    }

    if (key === "w") {
      const sameGroup = state.commandGroup?.key === key;
      if (sameGroup) {
        // A second W can legitimately modify a second vowel in free-mark mode.
        // Only escape when there is no additional shape operation available.
        if (tryWShape(state, options, false, rawChar)) continue;
        escapeRepeatedCommand(state, rawChar);
        continue;
      }

      const before = cloneCoreState(state);
      if (tryWShape(state, options, true, rawChar)) {
        beginOrContinueGroup(state, key, before);
      } else {
        appendOrdinary(state, rawChar);
      }
      continue;
    }

    if (IMMEDIATE_SHAPE[key] !== undefined) {
      const sameGroup = state.commandGroup?.key === key;
      if (sameGroup) {
        if (options.freeShapeMarks && tryFreeDelayedShape(state, key)) continue;
        escapeRepeatedCommand(state, rawChar);
        continue;
      }

      const before = cloneCoreState(state);
      if (
        tryImmediateDoubleShape(state, key) ||
        (options.freeShapeMarks && tryFreeDelayedShape(state, key))
      ) {
        beginOrContinueGroup(state, key, before);
      } else {
        appendOrdinary(state, rawChar);
      }
      continue;
    }

    appendOrdinary(state, rawChar);
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
  return mode === "standard" && (char === "[" || char === "]");
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
 * Small replay-based composition helper for an IME/editor integration.
 *
 * Keeping raw keystrokes as the source of truth makes backspace exact and lets
 * tone placement move when later letters change the best syllable analysis.
 */
export class TelexComposer {
  private readonly options: Required<TelexOptions>;
  private keys: string[] = [];
  private rendered = "";

  constructor(options?: TelexOptions) {
    this.options = optionsWithDefaults(options);
  }

  get raw(): string {
    return this.keys.join("");
  }

  get text(): string {
    return this.rendered;
  }

  push(key: string): string {
    const chars = Array.from(key);
    if (chars.length !== 1) {
      throw new TypeError("TelexComposer.push() expects exactly one character");
    }
    this.keys.push(chars[0]);
    this.recompute();
    return this.rendered;
  }

  backspace(): string {
    this.keys.pop();
    this.recompute();
    return this.rendered;
  }

  replaceRaw(raw: string): string {
    this.keys = Array.from(raw.normalize("NFC"));
    this.recompute();
    return this.rendered;
  }

  clear(): void {
    this.keys = [];
    this.rendered = "";
  }

  commit(): string {
    const text = this.rendered;
    this.clear();
    return text;
  }

  private recompute(): void {
    this.rendered = convertTelex(this.raw, this.options);
  }
}
