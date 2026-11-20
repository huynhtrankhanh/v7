/**
 * Clean-room UniKey-compatible Vietnamese Telex engine.
 *
 * Implements standard Vietnamese Telex input with classic (old-style) tone
 * placement matching V7 and ibus-unikey defaults:
 *   - Vowel shapes: aa -> â, aw -> ă, ee -> ê, oo -> ô, ow -> ơ, uw -> ư,
 *     uow -> ươ (with two-stage thuo+w -> thuơ -> thươ+coda), dd -> đ
 *   - Standard mode standalone w -> ư and [ / ] / { / } -> ơ / ư / Ơ / Ư
 *   - Tones: s (acute), f (grave), r (hook), x (tilde), j (dot), z (tone zero)
 *   - Free marking (delayed shapes & tones after codas)
 *   - Vietnamese syllable spell-checking during typing
 *   - Auto-restore of non-Vietnamese words on word-break terminators
 *   - Visible-character backspace with tone relocation and raw-key tracking
 */

/** Classic UniKey-like Telex or the newer "Simple Telex" key set. */
export type TelexMode = "standard" | "simple";

/** The five Vietnamese lexical tones entered by Telex tone keys. */
export type TelexTone = "acute" | "grave" | "hook" | "tilde" | "dot";

export type TonePlacementSource =
  | "v7-broad-exact"
  | "v7-broad-signature"
  | "mechanical"
  | "none";

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

  /**
   * Enforce Vietnamese syllable validity before applying tones/shapes.
   * Enabled by default to match ibus-unikey.
   */
  spellCheck?: boolean;

  /**
   * Restore raw Latin keystrokes on word-break terminators when a word with
   * Vietnamese marks is not a complete valid Vietnamese syllable.
   * Enabled by default to match ibus-unikey.
   */
  autoRestoreNonVn?: boolean;
};

export const DEFAULT_TELEX_OPTIONS: Readonly<Required<TelexOptions>> = {
  mode: "standard",
  freeShapeMarks: true,
  spellCheck: true,
  autoRestoreNonVn: true,
};

export type TelexStepResult = {
  /** Word text finalized if this key terminated the active composition (empty if none). */
  committedWord: string;
  /** Separator/literal suffix committed after committedWord (empty if none). */
  committedSuffix: string;
  /** Active composing preedit text remaining after this step. */
  preedit: string;
  /** True if this step terminated the active word composition. */
  terminated: boolean;
  /** True if the step was handled by the Telex composer (false only for backspace on empty preedit). */
  handled: boolean;
};

type VowelShape = "plain" | "circumflex" | "breve" | "horn";
type ShortcutKey = "w" | "[" | "]" | "{" | "}";

type WordEntry = {
  base: string;
  upper: boolean;
  shape: VowelShape;
  barredD: boolean;
  tone: TelexTone | null;
  fromKey: ShortcutKey | null;
};

type VowelSeqSpec = {
  complete: boolean;
  openToneIdx: number;
  closedToneIdx: number | null;
  codas: ReadonlySet<string>;
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
const PLAIN_VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

const VALID_ONSETS = new Set([
  "",
  "b",
  "c",
  "ch",
  "d",
  "đ",
  "dz",
  "g",
  "gh",
  "gi",
  "h",
  "k",
  "kh",
  "l",
  "m",
  "n",
  "ng",
  "ngh",
  "nh",
  "p",
  "ph",
  "q",
  "qu",
  "r",
  "s",
  "t",
  "th",
  "tr",
  "v",
  "x",
  "z",
]);

const VALID_CODAS = new Set(["c", "ch", "m", "n", "ng", "nh", "p", "t"]);
const STOP_CODAS = new Set(["c", "ch", "p", "t"]);

const NO_CODAS: ReadonlySet<string> = new Set();
const ALL_CODAS: ReadonlySet<string> = new Set([
  "c",
  "ch",
  "m",
  "n",
  "ng",
  "nh",
  "p",
  "t",
]);
const NO_CH_NH: ReadonlySet<string> = new Set(["c", "m", "n", "ng", "p", "t"]);
const NO_NG: ReadonlySet<string> = new Set(["c", "ch", "m", "n", "nh", "p", "t"]);
const CODAS_OH: ReadonlySet<string> = new Set(["m", "n", "p", "t"]);
const CODAS_UW: ReadonlySet<string> = new Set(["c", "m", "n", "ng", "t"]);
const CODAS_Y: ReadonlySet<string> = new Set(["t"]);
const CODAS_QU_Y: ReadonlySet<string> = new Set(["n", "nh", "t"]);
const CODAS_OAW: ReadonlySet<string> = new Set(["c", "m", "n", "ng", "t"]);
const CODAS_OE: ReadonlySet<string> = new Set(["n", "t"]);
const CODAS_UA: ReadonlySet<string> = new Set(["n", "ng", "t"]);
const CODAS_UE: ReadonlySet<string> = new Set(["c", "ch", "n", "nh"]);
const CODAS_UO: ReadonlySet<string> = new Set(["c", "m", "n", "ng", "t"]);
const CODAS_UY: ReadonlySet<string> = new Set(["c", "ch", "n", "nh", "p", "t"]);
const CODAS_YE: ReadonlySet<string> = new Set(["m", "n", "ng", "t"]);
const CODAS_UYE: ReadonlySet<string> = new Set(["n", "t"]);

const VOWEL_SEQS: Readonly<Record<string, VowelSeqSpec>> = {
  // Single vowels
  a: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: ALL_CODAS },
  ă: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: NO_CH_NH },
  â: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: NO_CH_NH },
  e: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: ALL_CODAS },
  ê: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: NO_NG },
  i: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: NO_NG },
  o: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: NO_CH_NH },
  ô: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: NO_CH_NH },
  ơ: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: CODAS_OH },
  u: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: NO_CH_NH },
  ư: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: CODAS_UW },
  y: { complete: true, openToneIdx: 0, closedToneIdx: 0, codas: CODAS_Y },

  // Complete 2-vowel sequences (open-only)
  ai: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ao: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  au: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ay: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  âu: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ây: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  eo: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  êu: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ia: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  iu: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  oi: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ôi: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ơi: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ui: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ưa: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ưi: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ưu: { complete: true, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },

  // Complete 2-vowel sequences (open and closed)
  iê: { complete: true, openToneIdx: 1, closedToneIdx: 1, codas: NO_CH_NH },
  oa: { complete: true, openToneIdx: 0, closedToneIdx: 1, codas: ALL_CODAS },
  oă: { complete: true, openToneIdx: 1, closedToneIdx: 1, codas: CODAS_OAW },
  oe: { complete: true, openToneIdx: 0, closedToneIdx: 1, codas: CODAS_OE },
  ua: { complete: true, openToneIdx: 0, closedToneIdx: 1, codas: CODAS_UA },
  uâ: { complete: true, openToneIdx: 1, closedToneIdx: 1, codas: CODAS_UA },
  uê: { complete: true, openToneIdx: 1, closedToneIdx: 1, codas: CODAS_UE },
  uô: { complete: true, openToneIdx: 1, closedToneIdx: 1, codas: CODAS_UO },
  uơ: { complete: true, openToneIdx: 1, closedToneIdx: 1, codas: NO_CH_NH },
  uy: { complete: true, openToneIdx: 0, closedToneIdx: 1, codas: CODAS_UY },
  ươ: { complete: true, openToneIdx: 1, closedToneIdx: 1, codas: NO_CH_NH },
  yê: { complete: true, openToneIdx: 1, closedToneIdx: 1, codas: CODAS_YE },

  // Intermediate/incomplete 2-vowel sequences (accept marks while typing, auto-restore on commit)
  eu: { complete: false, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ie: { complete: false, openToneIdx: 0, closedToneIdx: 1, codas: NO_CH_NH },
  ue: { complete: false, openToneIdx: 0, closedToneIdx: 1, codas: CODAS_UE },
  uo: { complete: false, openToneIdx: 0, closedToneIdx: 1, codas: NO_CH_NH },
  uu: { complete: false, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ưo: { complete: false, openToneIdx: 0, closedToneIdx: 1, codas: NO_CH_NH },
  ye: { complete: false, openToneIdx: 0, closedToneIdx: 1, codas: CODAS_YE },

  // Complete 3-vowel sequences
  iêu: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  oai: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  oay: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  oeo: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uây: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uôi: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  ươi: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  ươu: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uya: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uyê: { complete: true, openToneIdx: 2, closedToneIdx: 2, codas: CODAS_UYE },
  uyu: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  yêu: { complete: true, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },

  // Intermediate/incomplete 3-vowel sequences
  ieu: { complete: false, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uay: { complete: false, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uoi: { complete: false, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uou: { complete: false, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uye: { complete: false, openToneIdx: 1, closedToneIdx: 1, codas: CODAS_UYE },
  yeu: { complete: false, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uơi: { complete: false, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  uơu: { complete: false, openToneIdx: 1, closedToneIdx: null, codas: NO_CODAS },
  ưoi: { complete: false, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
  ưou: { complete: false, openToneIdx: 0, closedToneIdx: null, codas: NO_CODAS },
};

const SHAPED_CHAR: Readonly<Record<string, string>> = {
  "a:plain": "a",
  "a:circumflex": "â",
  "a:breve": "ă",
  "e:plain": "e",
  "e:circumflex": "ê",
  "o:plain": "o",
  "o:circumflex": "ô",
  "o:horn": "ơ",
  "u:plain": "u",
  "u:horn": "ư",
};

const DECOMPOSE_VI_LETTER: Readonly<
  Record<string, { base: string; shape: VowelShape; barredD?: boolean }>
> = {
  a: { base: "a", shape: "plain" },
  ă: { base: "a", shape: "breve" },
  â: { base: "a", shape: "circumflex" },
  e: { base: "e", shape: "plain" },
  ê: { base: "e", shape: "circumflex" },
  i: { base: "i", shape: "plain" },
  o: { base: "o", shape: "plain" },
  ô: { base: "o", shape: "circumflex" },
  ơ: { base: "o", shape: "horn" },
  u: { base: "u", shape: "plain" },
  ư: { base: "u", shape: "horn" },
  y: { base: "y", shape: "plain" },
  đ: { base: "d", shape: "plain", barredD: true },
};

const SHORTCUT_SPEC: Readonly<
  Record<ShortcutKey, { base: "o" | "u"; shape: "horn"; upper: boolean }>
> = {
  "[": { base: "o", shape: "horn", upper: false },
  "{": { base: "o", shape: "horn", upper: true },
  "]": { base: "u", shape: "horn", upper: false },
  "}": { base: "u", shape: "horn", upper: true },
  w: { base: "u", shape: "horn", upper: false },
};

/** Terminators that commit the current preedit verbatim WITHOUT auto-restore (matching ibus-unikey). */
const NO_RESTORE_TERMINATORS = new Set(["\t", "\n", "\r", "^", "`", "~"]);

function optionsWithDefaults(options?: TelexOptions): Required<TelexOptions> {
  return {
    mode: options?.mode ?? DEFAULT_TELEX_OPTIONS.mode,
    freeShapeMarks:
      options?.freeShapeMarks ?? DEFAULT_TELEX_OPTIONS.freeShapeMarks,
    spellCheck: options?.spellCheck ?? DEFAULT_TELEX_OPTIONS.spellCheck,
    autoRestoreNonVn:
      options?.autoRestoreNonVn ?? DEFAULT_TELEX_OPTIONS.autoRestoreNonVn,
  };
}

function isAsciiLetter(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isBracketShortcut(ch: string): ch is "[" | "]" | "{" | "}" {
  return ch === "[" || ch === "]" || ch === "{" || ch === "}";
}

function isUppercaseLetter(char: string): boolean {
  return char !== char.toLocaleLowerCase("vi");
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

function entryShapedLower(entry: WordEntry): string {
  if (entry.barredD) return "đ";
  if (entry.shape !== "plain") {
    return SHAPED_CHAR[`${entry.base}:${entry.shape}`] ?? entry.base;
  }
  return entry.base;
}

function renderEntry(entry: WordEntry): string {
  let ch = entryShapedLower(entry);
  if (entry.upper) ch = ch.toLocaleUpperCase("vi");
  if (entry.tone !== null) ch = applyToneToChar(ch, entry.tone);
  return ch.normalize("NFC");
}

function renderEntries(entries: WordEntry[]): string {
  let out = "";
  for (let i = 0; i < entries.length; i++) out += renderEntry(entries[i]);
  return out.normalize("NFC");
}

function entryFromChar(char: string): WordEntry {
  const nfc = char.normalize("NFC");
  const tone = toneOfChar(nfc);
  const untoned = stripToneFromChar(nfc);
  const upper = isUppercaseLetter(untoned);
  const lower = untoned.toLocaleLowerCase("vi");
  const decomposed = DECOMPOSE_VI_LETTER[lower];
  if (decomposed) {
    return {
      base: decomposed.base,
      upper,
      shape: decomposed.shape,
      barredD: Boolean(decomposed.barredD),
      tone,
      fromKey: null,
    };
  }
  return {
    base: lower,
    upper,
    shape: "plain",
    barredD: false,
    tone: null,
    fromKey: null,
  };
}

function isVowelEntry(entry: WordEntry): boolean {
  return !entry.barredD && PLAIN_VOWELS.has(entry.base);
}

function isLetterEntry(entry: WordEntry): boolean {
  return entry.barredD || isAsciiLetter(entry.base);
}

type ParsedSyllable = {
  c1: string;
  c1Start: number;
  vStart: number;
  vEnd: number; // exclusive
  vStr: string;
  c2Start: number;
  c2: string;
  vSpec: VowelSeqSpec | null;
  canTransform: boolean;
  isCompleteVn: boolean;
  toneCarrierIndex: number | null;
};

function isOnsetVowelCompatible(c1: string, vStr: string): boolean {
  if (!VALID_ONSETS.has(c1)) return false;
  if (vStr.length === 0) return true;
  if (c1 === "k") {
    // In ibus-unikey, `k` only accepts e, ê, i, y (and vowel seqs starting with e/ê/i, NOT ye/yê).
    if (vStr.startsWith("ye") || vStr.startsWith("yê")) return false;
    const first = vStr[0];
    return first === "e" || first === "ê" || first === "i" || first === "y";
  }
  if (c1 === "qu") {
    const first = vStr[0];
    if (first === "u" || first === "ư") return false;
  }
  if (c1 === "gi") {
    const first = vStr[0];
    if (first === "i") return false;
  }
  return true;
}

function parseSlice(entries: WordEntry[], start: number): ParsedSyllable {
  const n = entries.length;
  const invalid: ParsedSyllable = {
    c1: "",
    c1Start: start,
    vStart: start,
    vEnd: start,
    vStr: "",
    c2Start: start,
    c2: "",
    vSpec: null,
    canTransform: false,
    isCompleteVn: false,
    toneCarrierIndex: null,
  };

  if (start >= n) return invalid;

  // Non-letter entries (digits, symbols) break Vietnamese syllable validity.
  for (let i = start; i < n; i++) {
    if (!isLetterEntry(entries[i])) return invalid;
  }

  // Scan initial consonant c1 until first vowel.
  let idx = start;
  while (idx < n && !isVowelEntry(entries[idx])) idx++;

  // Handle `qu` + vowel (or `qu` alone with no trailing vowels -> `u` is part of `qu`, not vowel!)
  if (
    idx === start + 1 &&
    entries[start].base === "q" &&
    !entries[start].barredD &&
    idx < n &&
    entries[idx].base === "u" &&
    entries[idx].shape === "plain"
  ) {
    idx++;
  } else if (
    // Handle `gi` + another vowel -> `gi` is c1!
    idx === start + 1 &&
    entries[start].base === "g" &&
    !entries[start].barredD &&
    idx + 1 < n &&
    entries[idx].base === "i" &&
    entries[idx].shape === "plain" &&
    isVowelEntry(entries[idx + 1])
  ) {
    idx++;
  }

  let c1 = "";
  for (let i = start; i < idx; i++) c1 += entryShapedLower(entries[i]);

  const vStart = idx;
  while (idx < n && isVowelEntry(entries[idx])) idx++;
  const vEnd = idx;

  const c2Start = idx;
  while (idx < n && !isVowelEntry(entries[idx])) idx++;
  // If another vowel appears after c2 (e.g. `sẻve`, `ưater`), not a valid syllable!
  if (idx < n) return invalid;

  let vStr = "";
  for (let i = vStart; i < vEnd; i++) vStr += entryShapedLower(entries[i]);

  let c2 = "";
  for (let i = c2Start; i < n; i++) c2 += entryShapedLower(entries[i]);

  if (!VALID_ONSETS.has(c1)) return invalid;
  if (vStr.length === 0) {
    return {
      c1,
      c1Start: start,
      vStart,
      vEnd,
      vStr,
      c2Start,
      c2,
      vSpec: null,
      canTransform: c2.length === 0,
      isCompleteVn: c1 === "đ" && c2.length === 0,
      toneCarrierIndex: null,
    };
  }

  const vSpec = VOWEL_SEQS[vStr] ?? null;
  if (!vSpec) return invalid;
  if (!isOnsetVowelCompatible(c1, vStr)) return invalid;

  let allowedCodas = vSpec.codas;
  if (c1 === "qu" && vStr === "y") {
    allowedCodas = CODAS_QU_Y;
  } else if (c1 === "gi" && vStr === "ê") {
    allowedCodas = ALL_CODAS;
  }

  let codaValid = true;
  if (c2.length > 0) {
    if (!VALID_CODAS.has(c2) || !allowedCodas.has(c2)) {
      codaValid = false;
    }
  }

  if (!codaValid) return invalid;

  const relToneIdx =
    c2.length === 0 ? vSpec.openToneIdx : vSpec.closedToneIdx;
  const toneCarrierIndex =
    relToneIdx !== null ? vStart + relToneIdx : null;

  // Check active tone against stop codas.
  let activeTone: TelexTone | null = null;
  for (let i = vStart; i < vEnd; i++) {
    if (entries[i].tone !== null) {
      activeTone = entries[i].tone;
      break;
    }
  }
  const toneValidForCoda =
    activeTone === null ||
    !STOP_CODAS.has(c2) ||
    activeTone === "acute" ||
    activeTone === "dot";

  const isCompleteVn = vSpec.complete && toneValidForCoda;

  return {
    c1,
    c1Start: start,
    vStart,
    vEnd,
    vStr,
    c2Start,
    c2,
    vSpec,
    canTransform: true,
    isCompleteVn,
    toneCarrierIndex,
  };
}

function parseWord(entries: WordEntry[]): ParsedSyllable {
  return parseSlice(entries, 0);
}

function getActiveTone(entries: WordEntry[], start: number): {
  tone: TelexTone | null;
  index: number;
} {
  for (let i = start; i < entries.length; i++) {
    if (entries[i].tone !== null) {
      return { tone: entries[i].tone, index: i };
    }
  }
  return { tone: null, index: -1 };
}

function clearTonesFrom(entries: WordEntry[], start: number): void {
  for (let i = start; i < entries.length; i++) {
    entries[i].tone = null;
  }
}

function relocateToneIfValid(entries: WordEntry[]): void {
  const parsed = parseWord(entries);
  if (!parsed.canTransform || parsed.toneCarrierIndex === null) return;
  const active = getActiveTone(entries, parsed.vStart);
  if (active.tone === null) return;
  if (active.index === parsed.toneCarrierIndex) return;
  clearTonesFrom(entries, parsed.vStart);
  entries[parsed.toneCarrierIndex].tone = active.tone;
}

function hasAnyVnMark(entries: WordEntry[]): boolean {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.shape !== "plain" || e.barredD || e.tone !== null) return true;
  }
  return false;
}

function hasShortcutOrigin(entries: WordEntry[]): boolean {
  for (let i = 0; i < entries.length; i++) {
    const fk = entries[i].fromKey;
    if (fk === "[" || fk === "]" || fk === "{" || fk === "}") return true;
  }
  return false;
}

function cloneEntries(entries: WordEntry[]): WordEntry[] {
  return entries.map((e) => ({ ...e }));
}

function mechanicalToneIndex(entries: WordEntry[]): number | null {
  let lastRunStart = -1;
  let lastRunEnd = -1;
  let i = entries.length - 1;
  while (i >= 0 && !isVowelEntry(entries[i])) i--;
  if (i < 0) return null;
  lastRunEnd = i + 1;
  while (i >= 0 && isVowelEntry(entries[i])) i--;
  lastRunStart = i + 1;

  for (let j = lastRunEnd - 1; j >= lastRunStart; j--) {
    if (entries[j].shape !== "plain") return j;
  }
  return lastRunEnd - 1;
}

/**
 * Locate the tone-bearing vowel in a word using UniKey's classic Vietnamese
 * tone-placement rules, with deterministic fallback for malformed input.
 */
export function findTelexToneCarrier(text: string): TonePlacement {
  const normalized = stripVietnameseTone(text).normalize("NFC");
  const chars = Array.from(normalized);
  if (chars.length === 0) return { index: null, source: "none" };
  const entries = chars.map(entryFromChar);
  const parsed = parseSlice(entries, 0);
  if (parsed.canTransform && parsed.toneCarrierIndex !== null) {
    return {
      index: parsed.toneCarrierIndex,
      source: parsed.isCompleteVn ? "v7-broad-exact" : "v7-broad-signature",
    };
  }
  const fallback = mechanicalToneIndex(entries);
  return fallback === null
    ? { index: null, source: "none" }
    : { index: fallback, source: "mechanical" };
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

type WordEngineState = {
  entries: WordEntry[];
  rawKeys: string[];
};

function createEmptyWordState(): WordEngineState {
  return { entries: [], rawKeys: [] };
}

function canCommitWithoutRestore(
  state: WordEngineState,
  options: Required<TelexOptions>,
): boolean {
  if (!options.autoRestoreNonVn) return true;
  if (state.entries.length === 0) return true;
  if (!hasAnyVnMark(state.entries)) return true;
  // Words containing bracket shortcuts ([ ] { }) are not restored to brackets
  // unless the bracket itself was escaped (handled immediately on key press).
  if (hasShortcutOrigin(state.entries)) {
    return true;
  }
  const parsed = parseWord(state.entries);
  if (parsed.isCompleteVn) return true;

  // Literal trailing `z` (tone-zero key when no tone was present) after a
  // complete open Vietnamese syllable preserves the preceding Vietnamese word
  // (e.g. `aaz` -> `âz`, `awz` -> `ăz`, `ddz` -> `đz`), whereas a closed
  // syllable + `z` (e.g. `muowmz`) auto-restores.
  const last = state.entries[state.entries.length - 1];
  if (last.base === "z" && !last.barredD && state.entries.length > 1) {
    const prefix = parseSlice(state.entries.slice(0, -1), 0);
    if (prefix.isCompleteVn && prefix.c2.length === 0) return true;
  }
  return false;
}

function finalizeWord(
  state: WordEngineState,
  options: Required<TelexOptions>,
  allowAutoRestore: boolean,
): string {
  if (state.entries.length === 0) return "";
  if (allowAutoRestore && !canCommitWithoutRestore(state, options)) {
    return state.rawKeys.join("").normalize("NFC");
  }
  return renderEntries(state.entries);
}

function tryUpgradeUoOnCoda(state: WordEngineState): void {
  const entries = state.entries;
  const parsed = parseSlice(entries, 0);
  if (!parsed.canTransform || parsed.c2.length === 0) return;
  if (parsed.vStr === "uơ" || parsed.vStr === "ưo") {
    entries[parsed.vStart].shape = "horn";
    entries[parsed.vStart + 1].shape = "horn";
  }
}

function appendLiteral(state: WordEngineState, ch: string): void {
  state.entries.push(entryFromChar(ch));
  state.rawKeys.push(ch);
  tryUpgradeUoOnCoda(state);
  relocateToneIfValid(state.entries);
}

function handleBracketKey(
  state: WordEngineState,
  ch: "[" | "]" | "{" | "}",
  options: Required<TelexOptions>,
): TelexStepResult {
  const spec = SHORTCUT_SPEC[ch];
  const entries = state.entries;

  // Check immediate undo: last char is the exact same shaped vowel (and same case for [/{ and ]/})
  if (entries.length > 0) {
    const last = entries[entries.length - 1];
    const sameVowel =
      last.base === spec.base && last.shape === "horn" && last.upper === spec.upper;
    if (sameVowel && (last.fromKey === ch || last.fromKey === "w")) {
      // Undo the vowel back to literal bracket and immediately commit word + bracket!
      entries.pop();
      const prefix = renderEntries(entries);
      state.entries = [];
      state.rawKeys = [];
      return {
        committedWord: prefix,
        committedSuffix: ch,
        preedit: "",
        terminated: true,
        handled: true,
      };
    }
  }

  // Test whether appending this vowel keeps a valid Vietnamese syllable.
  const candidate: WordEntry = {
    base: spec.base,
    upper: spec.upper,
    shape: "horn",
    barredD: false,
    tone: null,
    fromKey: ch,
  };
  const nextEntries = [...cloneEntries(entries), candidate];
  const parsed = parseSlice(nextEntries, 0);
  if (parsed.canTransform && parsed.vStr.length > 0) {
    state.entries.push(candidate);
    // In ibus-unikey, bracket keys are NOT auto-restored to `[`/`]`/`{`/`}` on word break.
    state.rawKeys.push(ch);
    relocateToneIfValid(state.entries);
    return {
      committedWord: "",
      committedSuffix: "",
      preedit: renderEntries(state.entries),
      terminated: false,
      handled: true,
    };
  }

  // Invalid position for bracket shortcut: terminate & commit word + literal bracket!
  const committedWord = finalizeWord(state, options, true);
  state.entries = [];
  state.rawKeys = [];
  return {
    committedWord,
    committedSuffix: ch,
    preedit: "",
    terminated: true,
    handled: true,
  };
}

function handleToneKey(
  state: WordEngineState,
  ch: string,
  tone: TelexTone,
  options: Required<TelexOptions>,
): void {
  const entries = state.entries;
  const parsed = parseWord(entries);

  if (options.spellCheck) {
    if (!parsed.canTransform || parsed.toneCarrierIndex === null) {
      appendLiteral(state, ch);
      return;
    }
    if (
      STOP_CODAS.has(parsed.c2) &&
      tone !== "acute" &&
      tone !== "dot"
    ) {
      appendLiteral(state, ch);
      return;
    }
    const active = getActiveTone(entries, parsed.vStart);
    if (active.tone === tone) {
      clearTonesFrom(entries, parsed.vStart);
      appendLiteral(state, ch);
      return;
    }
    clearTonesFrom(entries, parsed.vStart);
    entries[parsed.toneCarrierIndex].tone = tone;
    state.rawKeys.push(ch);
    return;
  }

  // Non-spellCheck fallback
  const carrier = mechanicalToneIndex(entries);
  if (carrier === null) {
    appendLiteral(state, ch);
    return;
  }
  const active = getActiveTone(entries, 0);
  if (active.tone === tone) {
    clearTonesFrom(entries, 0);
    appendLiteral(state, ch);
    return;
  }
  clearTonesFrom(entries, 0);
  entries[carrier].tone = tone;
  state.rawKeys.push(ch);
}

function handleZKey(
  state: WordEngineState,
  ch: string,
  options: Required<TelexOptions>,
): void {
  const parsed = parseWord(state.entries);
  if (options.spellCheck && !parsed.canTransform) {
    appendLiteral(state, ch);
    return;
  }
  const searchStart = parsed.canTransform ? parsed.vStart : 0;
  const active = getActiveTone(state.entries, searchStart);
  if (active.tone !== null) {
    clearTonesFrom(state.entries, searchStart);
    state.rawKeys.push(ch);
    return;
  }
  appendLiteral(state, ch);
}

function handleDKey(
  state: WordEngineState,
  ch: string,
  options: Required<TelexOptions>,
): void {
  const entries = state.entries;
  if (entries.length === 0) {
    appendLiteral(state, ch);
    return;
  }

  // Immediate `d` -> `đ` or `đ` -> `d`+`d` at the start of a word (or within a
  // pure `d` run like `dd`, `ddd`, `dddd`, `ddddd`). Never bar a medial/final
  // `dd` in English words like `add`, `address`, `middle`, `padding`, `reddit`.
  const last = entries[entries.length - 1];
  if (last.base === "d") {
    if (last.barredD) {
      last.barredD = false;
      appendLiteral(state, ch);
      return;
    }
    const allDs = entries.every((e) => e.base === "d");
    if (allDs) {
      last.barredD = true;
      state.rawKeys.push(ch);
      return;
    }
  }

  // Delayed `d` affecting initial `d`/`đ` (e.g. `duongd` -> `đuong`, `ddud` -> `dud`)
  if (options.freeShapeMarks && entries[0].base === "d") {
    const parsed = parseSlice(entries, 0);
    if (!options.spellCheck || parsed.canTransform) {
      if (entries[0].barredD) {
        entries[0].barredD = false;
        appendLiteral(state, ch);
        return;
      }
      entries[0].barredD = true;
      state.rawKeys.push(ch);
      return;
    }
  }

  appendLiteral(state, ch);
}

function handleDoubleVowelKey(
  state: WordEngineState,
  ch: string,
  key: "a" | "e" | "o",
  options: Required<TelexOptions>,
): void {
  const entries = state.entries;
  const parsed = parseWord(entries);

  if (options.spellCheck && (!parsed.canTransform || parsed.vStr.length === 0)) {
    appendLiteral(state, ch);
    return;
  }

  const vStart = parsed.canTransform ? parsed.vStart : 0;
  const vEnd = parsed.canTransform ? parsed.vEnd : entries.length;
  const hasCoda = parsed.canTransform && parsed.c2.length > 0;
  if (hasCoda && !options.freeShapeMarks) {
    appendLiteral(state, ch);
    return;
  }

  // Scan right-to-left in vowel nucleus for matching base vowel.
  for (let i = vEnd - 1; i >= vStart; i--) {
    const e = entries[i];
    if (e.base !== key) continue;

    if (e.shape === "circumflex") {
      // Undo circumflex -> plain, relocate any tone on the unshaped vowel, then append literal key.
      e.shape = "plain";
      relocateToneIfValid(entries);
      appendLiteral(state, ch);
      return;
    }

    // Try applying circumflex (and for `ươ` + `o`, clear horn on `u` -> `uô`!).
    const testEntries = cloneEntries(entries);
    testEntries[i].shape = "circumflex";
    if (
      key === "o" &&
      i > vStart &&
      testEntries[i - 1].base === "u" &&
      testEntries[i - 1].shape === "horn"
    ) {
      testEntries[i - 1].shape = "plain";
    }

    const nextParsed = parseSlice(testEntries, parsed.c1Start);
    if (!options.spellCheck || (nextParsed.canTransform && nextParsed.vStr.length > 0)) {
      entries[i].shape = "circumflex";
      if (
        key === "o" &&
        i > vStart &&
        entries[i - 1].base === "u" &&
        entries[i - 1].shape === "horn"
      ) {
        entries[i - 1].shape = "plain";
      }
      state.rawKeys.push(ch);
      relocateToneIfValid(entries);
      return;
    }
  }

  appendLiteral(state, ch);
}

function handleWKey(
  state: WordEngineState,
  ch: string,
  options: Required<TelexOptions>,
): void {
  const entries = state.entries;
  const isUpper = ch === "W";

  // 1. Standalone `w` -> `ư` / `Ư` when there are no vowels yet and mode === "standard".
  if (options.mode === "standard") {
    const parsed0 = parseSlice(entries, 0);
    if (entries.length === 0 || (parsed0.canTransform && parsed0.vStr.length === 0)) {
      const candidate: WordEntry = {
        base: "u",
        upper: isUpper,
        shape: "horn",
        barredD: false,
        tone: null,
        fromKey: "w",
      };
      const testEntries = [...cloneEntries(entries), candidate];
      const nextParsed = parseSlice(testEntries, 0);
      if (nextParsed.canTransform && nextParsed.vStr.length > 0) {
        entries.push(candidate);
        state.rawKeys.push(ch);
        return;
      }
      appendLiteral(state, ch);
      return;
    }
  }

  // 2. Undo standalone `w` immediately (`ww` -> `w`, `WW` -> `W`, `Ww` -> `Uw`, `wW` -> `uW`).
  if (entries.length > 0) {
    const last = entries[entries.length - 1];
    if (last.fromKey === "w" && last.base === "u" && last.shape === "horn") {
      if (last.upper === isUpper) {
        // Same case: replace `ư` with literal `w`/`W`.
        entries.pop();
        appendLiteral(state, ch);
        return;
      }
      // Different case: unhorn `Ư`/`ư` -> `U`/`u` and append literal `w`/`W`!
      last.shape = "plain";
      last.fromKey = null;
      appendLiteral(state, ch);
      return;
    }
  }

  const parsed = parseWord(entries);
  if (options.spellCheck && (!parsed.canTransform || parsed.vStr.length === 0)) {
    appendLiteral(state, ch);
    return;
  }

  const vStart = parsed.canTransform ? parsed.vStart : 0;
  const vEnd = parsed.canTransform ? parsed.vEnd : entries.length;
  const hasCoda = parsed.canTransform && parsed.c2.length > 0;
  if (hasCoda && !options.freeShapeMarks) {
    appendLiteral(state, ch);
    return;
  }

  // 3. Check adjacent `u` + `o` family (`uo`, `uô`, `uơ`, `ưo`, `ươ`) inside the vowel nucleus.
  for (let i = vEnd - 2; i >= vStart; i--) {
    const left = entries[i];
    const right = entries[i + 1];
    if (left.base !== "u" || right.base !== "o") continue;

    // Already `ươ` -> undo both horns back to `uo`, relocate tone, and append literal `w`.
    if (left.shape === "horn" && right.shape === "horn") {
      left.shape = "plain";
      right.shape = "plain";
      relocateToneIfValid(entries);
      appendLiteral(state, ch);
      return;
    }

    // `uơ` -> `ươ` (e.g. `thuoww` -> `thươ`)
    if (left.shape === "plain" && right.shape === "horn") {
      const testEntries = cloneEntries(entries);
      testEntries[i].shape = "horn";
      const nextParsed = parseSlice(testEntries, parsed.c1Start);
      if (!options.spellCheck || nextParsed.canTransform) {
        left.shape = "horn";
        state.rawKeys.push(ch);
        relocateToneIfValid(entries);
        return;
      }
    }

    // `ưo` -> `ươ`
    if (left.shape === "horn" && right.shape === "plain") {
      const testEntries = cloneEntries(entries);
      testEntries[i + 1].shape = "horn";
      const nextParsed = parseSlice(testEntries, parsed.c1Start);
      if (!options.spellCheck || nextParsed.canTransform) {
        right.shape = "horn";
        state.rawKeys.push(ch);
        relocateToneIfValid(entries);
        return;
      }
    }

    // `uo` or `uô` -> `thuơ` (only for open `th` + `uo`/`uô`) or `ươ`
    if (left.shape === "plain" && (right.shape === "plain" || right.shape === "circumflex")) {
      const isOpenThuo =
        parsed.c1 === "th" && !hasCoda && vEnd - vStart === 2;
      const testEntries = cloneEntries(entries);
      if (isOpenThuo) {
        testEntries[i + 1].shape = "horn";
      } else {
        testEntries[i].shape = "horn";
        testEntries[i + 1].shape = "horn";
      }
      const nextParsed = parseSlice(testEntries, parsed.c1Start);
      if (!options.spellCheck || nextParsed.canTransform) {
        if (isOpenThuo) {
          right.shape = "horn";
        } else {
          left.shape = "horn";
          right.shape = "horn";
        }
        state.rawKeys.push(ch);
        relocateToneIfValid(entries);
        return;
      }
    }
  }

  // 4. Check `ua` / `ưa` and `uu` / `ưu` inside the vowel nucleus (horning the first `u`).
  for (let i = vEnd - 2; i >= vStart; i--) {
    const left = entries[i];
    const right = entries[i + 1];
    if (left.base === "u" && (right.base === "a" || right.base === "u") && right.shape === "plain") {
      if (left.shape === "horn") {
        // Undo `ưa`/`ưu` -> `ua`/`uu` + `w`
        left.shape = "plain";
        appendLiteral(state, ch);
        return;
      }
      const testEntries = cloneEntries(entries);
      testEntries[i].shape = "horn";
      const nextParsed = parseSlice(testEntries, parsed.c1Start);
      if (!options.spellCheck || nextParsed.canTransform) {
        left.shape = "horn";
        state.rawKeys.push(ch);
        relocateToneIfValid(entries);
        return;
      }
    }
  }

  // 5. Rightmost single modifiable vowel (`a`/`â` -> `ă`, `o`/`ô` -> `ơ`, `u` -> `ư`, or undo).
  for (let i = vEnd - 1; i >= vStart; i--) {
    const e = entries[i];
    if (e.base !== "a" && e.base !== "o" && e.base !== "u") continue;

    const targetShape: VowelShape = e.base === "a" ? "breve" : "horn";
    if (e.shape === targetShape) {
      e.shape = "plain";
      e.fromKey = null;
      appendLiteral(state, ch);
      return;
    }

    const testEntries = cloneEntries(entries);
    testEntries[i].shape = targetShape;
    const nextParsed = parseSlice(testEntries, parsed.c1Start);
    if (!options.spellCheck || nextParsed.canTransform) {
      e.shape = targetShape;
      state.rawKeys.push(ch);
      relocateToneIfValid(entries);
      return;
    }
  }

  appendLiteral(state, ch);
}

function stepWordKey(
  state: WordEngineState,
  rawChar: string,
  options: Required<TelexOptions>,
): TelexStepResult {
  const ch = rawChar.normalize("NFC");

  // 1. Bracket shortcuts in standard mode.
  if (options.mode === "standard" && isBracketShortcut(ch)) {
    return handleBracketKey(state, ch, options);
  }

  // 2. Non-alphanumeric terminators (Space, Tab, Enter, punctuation).
  if (!isAsciiLetter(ch) && !isAsciiDigit(ch) && !DECOMPOSE_VI_LETTER[stripToneFromChar(ch).toLocaleLowerCase("vi")]) {
    const allowAutoRestore = !NO_RESTORE_TERMINATORS.has(ch);
    const committedWord = finalizeWord(state, options, allowAutoRestore);
    state.entries = [];
    state.rawKeys = [];
    return {
      committedWord,
      committedSuffix: ch,
      preedit: "",
      terminated: true,
      handled: true,
    };
  }

  // 3. Digits stay in preedit (causing auto-restore on subsequent word break if marks exist).
  if (isAsciiDigit(ch)) {
    appendLiteral(state, ch);
    return {
      committedWord: "",
      committedSuffix: "",
      preedit: renderEntries(state.entries),
      terminated: false,
      handled: true,
    };
  }

  // 4. Telex command letters (ASCII only; precomposed Unicode letters append literally).
  if (isAsciiLetter(ch)) {
    const lower = ch.toLowerCase();
    const tone = TONE_BY_KEY[lower];
    if (tone) {
      handleToneKey(state, ch, tone, options);
    } else if (lower === "z") {
      handleZKey(state, ch, options);
    } else if (lower === "d") {
      handleDKey(state, ch, options);
    } else if (lower === "a" || lower === "e" || lower === "o") {
      handleDoubleVowelKey(state, ch, lower, options);
    } else if (lower === "w") {
      handleWKey(state, ch, options);
    } else {
      appendLiteral(state, ch);
    }
  } else {
    appendLiteral(state, ch);
  }

  return {
    committedWord: "",
    committedSuffix: "",
    preedit: renderEntries(state.entries),
    terminated: false,
    handled: true,
  };
}

function backspaceWord(state: WordEngineState): TelexStepResult {
  if (state.entries.length === 0) {
    return {
      committedWord: "",
      committedSuffix: "",
      preedit: "",
      terminated: false,
      handled: false,
    };
  }
  const popped = state.entries.pop()!;
  const poppedRaw = state.rawKeys.length > 0 ? state.rawKeys.pop()! : "";
  // If backspace deleted a character carrying a Vietnamese mark/tone, or
  // deleted a trailing vowel of a marked nucleus (where the popped raw key was
  // a modifier rather than that vowel, e.g. `tuys<BS>` or `suuw<BS>`), resync
  // rawKeys so auto-restore never resurrects deleted letters.
  const deletedMarkedNucleusTail =
    isVowelEntry(popped) &&
    poppedRaw.toLowerCase() !== popped.base &&
    state.entries.length > 0 &&
    isVowelEntry(state.entries[state.entries.length - 1]);
  if (
    deletedMarkedNucleusTail ||
    popped.tone !== null ||
    popped.shape !== "plain" ||
    popped.barredD
  ) {
    state.rawKeys = Array.from(renderEntries(state.entries));
  }
  relocateToneIfValid(state.entries);
  return {
    committedWord: "",
    committedSuffix: "",
    preedit: renderEntries(state.entries),
    terminated: false,
    handled: true,
  };
}

/** Convert one active, separator-free Telex composition (preedit view without trailing word break). */
export function convertTelexToken(raw: string, options?: TelexOptions): string {
  const resolved = optionsWithDefaults(options);
  const state = createEmptyWordState();
  let committed = "";
  for (const ch of Array.from(raw.normalize("NFC"))) {
    const res = stepWordKey(state, ch, resolved);
    if (res.terminated) {
      committed += res.committedWord + res.committedSuffix;
    }
  }
  return (committed + renderEntries(state.entries)).normalize("NFC");
}

/**
 * Convenience conversion for arbitrary text. Non-letter separators terminate
 * words (triggering auto-restore for non-Vietnamese words when enabled).
 */
export function convertTelex(input: string, options?: TelexOptions): string {
  const resolved = optionsWithDefaults(options);
  const state = createEmptyWordState();
  let committed = "";
  for (const ch of Array.from(input.normalize("NFC"))) {
    const res = stepWordKey(state, ch, resolved);
    if (res.terminated) {
      committed += res.committedWord + res.committedSuffix;
    }
  }
  return (committed + renderEntries(state.entries)).normalize("NFC");
}

/**
 * Stateful incremental Telex composer matching ibus-unikey semantics:
 *   - Visible-character backspace with tone relocation & raw-key tracking
 *   - Immediate commit on bracket escapes (`[[`, `[]`, `a[`)
 *   - Auto-restore of non-Vietnamese words on word-break terminators
 */
export class TelexComposer {
  private readonly options: Required<TelexOptions>;
  private committedPrefix = "";
  private wordState: WordEngineState = createEmptyWordState();
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

  get preedit(): string {
    return renderEntries(this.wordState.entries);
  }

  /**
   * Process one character and return the step result (suitable for Android IME
   * InputConnection synchronization).
   */
  stepKey(key: string): TelexStepResult {
    const chars = Array.from(key.normalize("NFC"));
    if (chars.length !== 1) {
      throw new TypeError("TelexComposer.stepKey() expects exactly one character");
    }
    const ch = chars[0];
    this.rawBuffer += ch;
    const res = stepWordKey(this.wordState, ch, this.options);
    if (res.terminated) {
      this.committedPrefix += res.committedWord + res.committedSuffix;
    }
    this.syncRendered();
    return res;
  }

  /**
   * Process Backspace on the active preedit (returning handled: false when
   * preedit is empty so an IME can forward Backspace to the host editor).
   */
  stepBackspace(): TelexStepResult {
    const res = backspaceWord(this.wordState);
    if (res.handled) {
      this.syncRendered();
      this.rawBuffer = this.rendered;
    }
    return res;
  }

  push(key: string): string {
    this.stepKey(key);
    return this.rendered;
  }

  backspace(): string {
    const res = backspaceWord(this.wordState);
    if (!res.handled && this.committedPrefix.length > 0) {
      const prefixChars = Array.from(this.committedPrefix);
      prefixChars.pop();
      this.committedPrefix = prefixChars.join("");
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
    this.wordState = createEmptyWordState();
    this.rawBuffer = "";
    this.rendered = "";
  }

  commit(allowAutoRestore = false): string {
    const word = finalizeWord(this.wordState, this.options, allowAutoRestore);
    const text = (this.committedPrefix + word).normalize("NFC");
    this.clear();
    return text;
  }

  private syncRendered(): void {
    this.rendered = (
      this.committedPrefix + renderEntries(this.wordState.entries)
    ).normalize("NFC");
  }
}
