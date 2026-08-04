import {
  TextBuffer,
  convertIslandsForInference,
  createIsland,
  ensureString,
} from "./textBuffer";
import { createUndoManager } from "./undoManager";
import {
  getCandidateSelectionMatch,
  getFirstCandidateAppendStroke,
  isLoneCandidateSelectionStroke,
} from "./candidateSelection";
import {
  assembleSyllable as assemble,
  parseSyllableStroke as parse,
} from "./syllableStroke";
import {
  buildCandidateDiffPlan,
  type CandidateDiffPlan,
  KeyboardStrokeTracker,
  findPiecemealSyllableTargets,
  getNextPiecemealCursorIndex,
  getPiecemealEntryIndex,
  groupVisibleTextSegmentsByCandidateSection,
  mapKeyUnique,
  normalizeQwertyDisplayKey,
  qwertyKeyboardLayout,
  renderVisibleText,
  renderVisibleTextSegments,
  replacePiecemealSyllable,
  selectCandidateIslands,
  stripVisibleTextSegments,
} from "./webCore";
import {
  isEmilyCapitalizationStroke,
  isRetiredEmilyCapitalizationStroke,
} from "./emilySymbols";
import { mountPloverDictionaryUi } from "./ploverDictionaryUi";

// Maps for V7 Decoding
const consonantIntMap = {};
consonantIntMap[0] = "0";
consonantIntMap[2 * 4 + 3] = "b";
consonantIntMap[1 * 4 + 1] = "k";
consonantIntMap[7 * 4 + 1] = "d";
consonantIntMap[1 * 4 + 3] = "dd";
consonantIntMap[3 * 4 + 0] = "ph";
consonantIntMap[3 * 4 + 3] = "g";
consonantIntMap[4 * 4 + 0] = "h";
consonantIntMap[7 * 4 + 2] = "z";
consonantIntMap[5 * 4 + 3] = "kh";
consonantIntMap[4 * 4 + 3] = "l";
consonantIntMap[6 * 4 + 0] = "m";
consonantIntMap[7 * 4 + 0] = "n";
consonantIntMap[7 * 4 + 3] = "nh";
consonantIntMap[3 * 4 + 1] = "ng";
consonantIntMap[2 * 4 + 0] = "p";
consonantIntMap[4 * 4 + 1] = "r";
consonantIntMap[3 * 4 + 2] = "s";
consonantIntMap[1 * 4 + 0] = "t";
consonantIntMap[5 * 4 + 0] = "th";
consonantIntMap[5 * 4 + 1] = "tr";
consonantIntMap[2 * 4 + 1] = "v";
consonantIntMap[6 * 4 + 1] = "x";
consonantIntMap[3] = "w";
consonantIntMap[5 * 4 + 2] = "ch";

const vowelIntMap = {
  1: "a",
  2: "o",
  3: "i",
  0: "e", // 0 can be e or u
};

// Emily symbols (subset mapping adapted from emily-symbols)
const EMILY_ATTACHMENT_METHOD = "space";
const EMILY_NO_SPACING_SYMBOLS = ["{*!}", "{*?}"];
const EMILY_SYMBOLS = {
  // System / navigation
  FG: ["{#Tab}", "{#Backspace}", "{#Delete}", "{#Escape}"],
  RPBG: ["{#Up}", "{#Left}", "{#Right}", "{#Down}"],
  FRPBG: ["{#Page_Up}", "{#Home}", "{#End}", "{#Page_Down}"],
  FRBG: ["{#AudioPlay}", "{#AudioPrev}", "{#AudioNext}", "{#AudioStop}"],
  FRB: [
    "{#AudioMute}",
    "{#AudioLowerVolume}",
    "{#AudioRaiseVolume}",
    "{#Eject}",
  ],
  "": ["", "{*!}", "{*?}", "{#Space}"],
  FL: ["{*-|}", "{*<}", "{<}", "{*>}"],
  // Symbols
  FR: ["!", "¬", "↦", "¡"],
  FP: ['"', "“", "”", "„"],
  FRLG: ["#", "©", "®", "™"],
  RPBL: ["$", "¥", "€", "£"],
  FRPB: ["%", "‰", "‱", "φ"],
  FBG: ["&", "∩", "∧", "∈"],
  F: ["'", "‘", "’", "‚"],
  FPL: ["(", "[", "<", "{"],
  RBG: [")", "]", ">", "}"],
  L: ["*", "∏", "§", "×"],
  G: ["+", "∑", "¶", "±"],
  B: [",", "∪", "∨", "∉"],
  PL: ["-", "−", "–", "—"],
  R: [".", "•", "·", "…"],
  RP: ["/", "⇒", "⇔", "÷"],
  LG: [":", "∋", "∵", "∴"],
  RB: [";", "∀", "∃", "∄"],
  PBLG: ["=", "≡", "≈", "≠"],
  FPB: ["?", "¿", "∝", "‽"],
  FRPBLG: ["@", "⊕", "⊗", "∅"],
  FB: ["\\", "Δ", "√", "∞"],
  RPG: ["^", "«", "»", "°"],
  BG: ["_", "≤", "≥", "µ"],
  P: ["`", "⊂", "⊃", "π"],
  PB: ["|", "⊤", "⊥", "¦"],
  FPBG: ["~", "⊆", "⊇", "˜"],
  FPBL: ["↑", "←", "→", "↓"],
};
const PUNCTUATION_MAP: Record<string, string> = {
  "TP-PL": ".",
  "KW-BG": ",",
  "KW-PL": "?",
  "TP-BG": "!",
};

function handleEmilySymbol(stroke) {
  // WHR replaces the otherwise ambiguous WH* capitalization command. The
  // right-hand R pattern remains WH-R and continues to produce a period.
  if (isEmilyCapitalizationStroke(stroke)) {
    return {
      type: "emily",
      value: "",
      leftSpace: false,
      rightSpace: false,
      explicitSpacing: true,
      capNext: true,
      retroSpace: null,
      repeat: 1,
    };
  }

  // stroke pattern: starter WH + attachments (A/O), capitalization (*), variants (E/U), pattern (FRPBLG)
  const match = stroke.match(
    /^([#]?WH)([AO]*)([*-]?)([EU]*)([FRPBLG]*)([TS]*)$/,
  );
  if (!match) return null;
  const [, starter, attachments, capKey, variantKeys, pattern, repeatKeys] =
    match;

  if (isRetiredEmilyCapitalizationStroke(stroke)) return null;

  if (!(pattern in EMILY_SYMBOLS)) return null;

  let variant = 0;
  if (variantKeys.includes("E")) variant += 1;
  if (variantKeys.includes("U")) variant += 2;
  const baseList = EMILY_SYMBOLS[pattern];
  const symbol = Array.isArray(baseList) ? baseList[variant] : baseList;

  let repeat = 1;
  if (repeatKeys.includes("S")) repeat += 1;
  if (repeatKeys.includes("T")) repeat += 2;

  const usesSpaceAttachment = EMILY_ATTACHMENT_METHOD === "space";
  const spaceBefore = usesSpaceAttachment
    ? attachments.includes("A")
    : !attachments.includes("A");
  const spaceAfter = usesSpaceAttachment
    ? attachments.includes("O")
    : !attachments.includes("O");

  let output = symbol.repeat(repeat);

  const capNext = capKey === "*";
  const shouldApplySpacing = !EMILY_NO_SPACING_SYMBOLS.includes(symbol);

  // leftSpace/rightSpace tags for spacing engine
  return {
    type: "emily",
    value: output,
    leftSpace: shouldApplySpacing ? spaceBefore : false,
    rightSpace: shouldApplySpacing ? spaceAfter : false,
    explicitSpacing: shouldApplySpacing,
    capNext,
    retroSpace:
      symbol === "{*?}" ? "insert" : symbol === "{*!}" ? "delete" : null,
    repeat,
  };
}

function applyRetroactiveSpace(action, repeat) {
  if (!action) return false;
  let changed = false;
  for (let i = 0; i < repeat; i++) {
    const islandCount = buffer.getIslandCount();
    if (islandCount === 0) break;
    const lastIndex = islandCount - 1;
    const last = buffer.getIslandAt(lastIndex);
    if (!last) break;
    if (last.type === "spacing" && last.value === " ") {
      if (action === "delete") {
        if (buffer.removeIslandAt(lastIndex)) {
          changed = true;
          continue;
        }
        break;
      }
      break;
    }
    if (lastIndex === 0) break;
    if (
      buffer.replaceIslandAt(lastIndex, {
        ...last,
        explicitSpacing: true,
        leftSpace: action === "insert",
      })
    ) {
      changed = true;
    }
    break;
  }
  return changed;
}

// --- V7 Decoding ---

function remapTone(t) {
  if (t === 3) return 4;
  if (t === 4) return 3;
  if (t === 5) return 6;
  if (t === 6) return 5;
  return t;
}

function getV7FromStroke(stroke) {
  if (!stroke.includes("*")) return null;
  const parts = stroke.split("*");

  if (parts.length !== 2) return null;
  const leftKeys = parts[0];
  const rightSide = parts[1];

  const hasSuffixD = rightSide.includes("D");
  const hasSuffixZ = rightSide.includes("Z");
  let rightKeys = rightSide.replace("D", "").replace("Z", "");

  // Left Syllable
  const lk = (k) => (leftKeys.includes(k) ? 1 : 0);
  const cA =
    lk("#") * 1 + lk("S") * 2 + lk("T") * 4 + lk("P") * 8 + lk("H") * 16;
  const tA = lk("K") * 1 + lk("W") * 2 + lk("R") * 4;
  const vA = lk("A") * 1 + lk("O") * 2;

  const consA = consonantIntMap[cA];
  if (consA === undefined) return null;
  let vowelCharA = vowelIntMap[vA];
  if (vA === 0) vowelCharA = hasSuffixD ? "u" : "e";

  // Right Syllable
  const rk = (k) => (rightKeys.includes(k) ? 1 : 0);
  const vB = rk("U") * 1 + rk("E") * 2;
  // F->C4, P->C3, L->C2, T->C0, S->C1
  const cB =
    rk("T") * 1 + rk("S") * 2 + rk("L") * 4 + rk("P") * 8 + rk("F") * 16;
  // G->T0, B->T1, R->T2
  const tB = rk("G") * 1 + rk("B") * 2 + rk("R") * 4;

  const consB = consonantIntMap[cB];
  if (consB === undefined) return null;
  let vowelCharB = vowelIntMap[vB];
  if (vB === 0) vowelCharB = hasSuffixZ ? "u" : "e";

  return (
    consA + vowelCharA + remapTone(tA) + consB + vowelCharB + remapTone(tB)
  );
}

// --- App State ---

const buffer = new TextBuffer();
const state = {
  get islands() {
    return buffer.getIslands();
  },
  set islands(next) {
    buffer.setIslands(next);
  },
  get pendingCapitalization() {
    return buffer.pendingCapitalization;
  },
  set pendingCapitalization(next) {
    buffer.pendingCapitalization = next;
  },
  candidates: [],
};
let isRawMode = false;
let inferenceErrorMessage = "";
let strippedDisplay: { enabled: boolean; copyAllowed: boolean } = {
  enabled: false,
  copyAllowed: false,
};

interface AndroidImeBridge {
  getInferenceModelError(): string;
  getInferenceModelState(): string;
  hasPloverConfiguration(): boolean;
  isPloverPaused?(): boolean;
  isRawOutlineMode?(): boolean;
  isStenoModeEnabled?(): boolean;
  changeInputMethod(): void;
  requestInference(body: string, requestId: number): void;
  requestInferenceSync?: (body: string, requestId: number) => string;
  requestPlover(body: string, requestId: number): void;
  setPreeditText(text: string, grammarSectionsJson: string): void;
  setKeyboardHeight(heightDp: number): void;
  undoRawOutlineStroke?(): void;
}

interface AndroidDictionaryBridge {
  hasPloverConfiguration(): boolean;
  requestPlover(body: string, requestId: number): void;
  saveDictionaryFile(filename: string, content: string, mimeType: string): void;
  enqueueDictionaryImport?(
    name: string,
    type: string,
    source: string,
    merge: boolean,
  ): string;
  enqueueSelectedDictionaryImport?(
    name: string,
    type: string,
    merge: boolean,
  ): string;
  getDictionaryImportState?(taskId: string): string;
  close(): void;
}

const androidIme = window.AndroidIme;
const androidDictionary = window.AndroidDictionary;
const androidPloverBridge = androidDictionary ?? androidIme;
const isDictionaryManagementPage = new URLSearchParams(
  window.location.search,
).has("dictionary-management");
const isTrainerEmbedded = new URLSearchParams(window.location.search).has(
  "trainer-embedded",
);
document.body.classList.toggle("trainer-embedded", isTrainerEmbedded);
let inferenceModelState = androidIme?.getInferenceModelState() ?? "ready";
let androidStenoModeEnabled = androidIme?.isStenoModeEnabled?.() ?? true;
let androidRawOutlineMode = androidIme?.isRawOutlineMode?.() ?? false;
let androidPloverPaused = androidIme?.isPloverPaused?.() ?? false;
if (androidIme) {
  inferenceErrorMessage = androidIme.getInferenceModelError();
}
let androidInferenceRequestId = 1;
let lastRequestedAndroidKeyboardHeight = 0;
const androidInferencePending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }
>();
let androidPloverRequestId = 1;
const ANDROID_PLOVER_REQUEST_TIMEOUT_MS = 180_000;
const androidPloverPending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }
>();

let piecemealCursorIndex: number | null = null;
let inferenceAbortController = null;
let isKeyboardLayoutVisible = false;
const pressedQwertyKeys = new Set<string>();
let strippedPlover = {
  available: false,
  enabled: false,
  solo: false,
  preeditIndex: null,
  requestId: 0,
};
let ploverDictionaries = [];
let ploverSocket = null;
let ploverSocketReady = null;
let ploverSocketReadyReject = null;
let ploverRpcId = 1;
const ploverPending = new Map();
const dictionaryInputIds = new Set([
  "plover-dict-name",
  "plover-new-dictionary-name",
  "plover-entry-search-stroke",
  "plover-entry-search-output",
  "plover-entry-stroke",
  "plover-entry-translation",
  "plover-lookup-stroke",
  "plover-lookup-translation",
]);
// Feature detection is performed once to keep behavior consistent for the module's lifetime.
const hasAbortController = typeof AbortController !== "undefined";
let ploverDictionarySignature = "";
let ploverEntrySearchPage = 1;
let ploverEntrySearchHasMore = false;
const PLOVER_ENTRY_PAGE_SIZE = 25;
const PLOVER_STATUS_RETRY_MS = 2000;
let ploverStatusTimer: ReturnType<typeof setTimeout> | null = null;
let ploverStatusCheckInFlight = false;
let androidDictionaryImportTaskId = "";
let androidDictionaryImportTimer: ReturnType<typeof setTimeout> | null = null;

function isDictionaryTextInputFocused(target = document.activeElement) {
  if (!target) return false;
  if (dictionaryInputIds.has(target.id)) return true;
  if (
    typeof target.closest === "function" &&
    target.closest("#plover-dictionary-dialog")
  ) {
    return true;
  }
  return false;
}

const undoManager = createUndoManager(
  buffer,
  (fields) => {
    state.candidates = [];
    piecemealCursorIndex = fields.piecemealCursorIndex ?? null;
    syncPloverPreeditIndex();
    updateDisplay();
    runInference();
  },
  {
    getPiecemealCursorIndex: () => piecemealCursorIndex,
  },
);

function saveState(group) {
  undoManager.save(group);
}

function restoreState() {
  undoManager.undo();
}

function setPloverMessage(message) {
  const messageEl = document.getElementById("plover-message");
  if (messageEl) {
    messageEl.textContent = message || "";
  }
}

function setEntryMessage(message) {
  const messageEl = document.getElementById("plover-entry-message");
  if (messageEl) {
    messageEl.textContent = message || "";
  }
}

function setLookupMessage(message) {
  const messageEl = document.getElementById("plover-lookup-message");
  if (messageEl) {
    messageEl.textContent = message || "";
  }
}

function setButtonLoading(button, isLoading, loadingText = "") {
  if (!button) return;
  if (button.tagName === "SELECT") {
    button.disabled = isLoading;
    button.setAttribute("aria-busy", isLoading ? "true" : "false");
    if (!isLoading) {
      button.removeAttribute("aria-busy");
      button.value = "";
    }
    return;
  }
  if (isLoading) {
    if (!button.dataset.label) {
      button.dataset.label = button.textContent || "";
    }
    button.textContent = loadingText;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  } else {
    if (button.dataset.label) {
      button.textContent = button.dataset.label;
      delete button.dataset.label;
    }
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

function getDictionarySignature(dictionaries) {
  return JSON.stringify(
    dictionaries.map((dict) => ({
      name: dict.name || "",
      identifier: dict.identifier || "",
      path: dict.path || "",
      entries: dict.entries ?? 0,
      readonly: !!dict.readonly,
      enabled: !!dict.enabled,
    })),
  );
}

function updatePloverDictionaries(nextDictionaries, { force = false } = {}) {
  const signature = getDictionarySignature(nextDictionaries);
  if (!force && signature === ploverDictionarySignature) {
    updatePloverSoloUI();
    return false;
  }
  ploverDictionarySignature = signature;
  ploverDictionaries = nextDictionaries;
  renderPloverDictionaries();
  return true;
}

function updatePloverSoloUI() {
  const statusEl = document.getElementById("plover-solo-status");
  const endSoloButton = document.getElementById("plover-end-solo");
  if (statusEl) {
    statusEl.textContent = strippedPlover.solo ? "Solo" : "Normal";
  }
  if (endSoloButton) {
    endSoloButton.disabled = !strippedPlover.available || !strippedPlover.solo;
  }
}

function updatePloverStatusUI() {
  const statusEl = document.getElementById("plover-status");
  const dictionaryButton = document.getElementById("plover-dictionary-open");
  if (statusEl) {
    if (androidPloverPaused) {
      statusEl.textContent = "PAUSED";
      statusEl.classList.remove("unavailable");
      statusEl.classList.add("available", "paused");
      if (dictionaryButton) dictionaryButton.disabled = true;
    } else if (strippedPlover.available) {
      statusEl.textContent = strippedPlover.enabled ? "Enabled" : "Available";
      statusEl.classList.remove("unavailable");
      statusEl.classList.remove("paused");
      statusEl.classList.add("available");
      if (dictionaryButton) dictionaryButton.disabled = false;
    } else {
      statusEl.textContent = "Unavailable";
      statusEl.classList.remove("available");
      statusEl.classList.remove("paused");
      statusEl.classList.add("unavailable");
      if (dictionaryButton) dictionaryButton.disabled = true;
    }
  }
  const banner = document.querySelector<HTMLElement>(
    ".ime-plover-banner strong",
  );
  if (banner) {
    banner.textContent = androidPloverPaused
      ? "Stripped Plover (PAUSED)"
      : "Stripped Plover";
  }
  document.body.classList.toggle("stripped-plover-paused", androidPloverPaused);
  updatePloverSoloUI();
}

async function fetchPloverStatus() {
  try {
    if (androidPloverBridge) {
      if (androidPloverBridge.hasPloverConfiguration()) {
        await requestAndroidPlover("get_starting_stroke_state", {});
        strippedPlover.available = true;
      } else {
        strippedPlover.available = false;
      }
    } else {
      const resp = await fetch("/plover/status");
      const data = await resp.json();
      strippedPlover.available = !!data.available;
    }
    if (!strippedPlover.available) {
      strippedPlover.enabled = false;
      strippedPlover.solo = false;
      strippedPlover.preeditIndex = null;
    }
  } catch (e) {
    strippedPlover.available = false;
    strippedPlover.enabled = false;
    strippedPlover.solo = false;
    strippedPlover.preeditIndex = null;
  }
  updatePloverStatusUI();
}

function clearPloverStatusTimer() {
  if (ploverStatusTimer) {
    clearTimeout(ploverStatusTimer);
    ploverStatusTimer = null;
  }
}

function schedulePloverStatusRetry() {
  clearPloverStatusTimer();
  if (androidPloverBridge && !androidPloverBridge.hasPloverConfiguration()) {
    return;
  }
  ploverStatusTimer = window.setTimeout(() => {
    ensurePloverAvailability().catch((err) =>
      console.error("Plover status retry failed:", err),
    );
  }, PLOVER_STATUS_RETRY_MS);
}

async function ensurePloverAvailability() {
  if (ploverStatusCheckInFlight) {
    return;
  }
  ploverStatusCheckInFlight = true;
  const wasAvailable = strippedPlover.available;
  try {
    await fetchPloverStatus();
    if (strippedPlover.available) {
      clearPloverStatusTimer();
      if (!wasAvailable) {
        await refreshPloverDictionaries({ force: true });
      }
    } else {
      schedulePloverStatusRetry();
    }
  } catch (e) {
    console.error("Failed to check Stripped Plover availability:", e);
    strippedPlover.available = false;
    updatePloverStatusUI();
    schedulePloverStatusRetry();
  } finally {
    ploverStatusCheckInFlight = false;
  }
}

function resetPloverSocket(message) {
  const error = new Error(message || "Stripped Plover connection lost");
  if (ploverSocket) {
    try {
      ploverSocket.close();
    } catch (e) {
      /* ignore */
    }
  }
  ploverSocket = null;
  if (ploverSocketReady) {
    if (ploverSocketReadyReject) {
      ploverSocketReadyReject(error);
    }
    ploverSocketReady = null;
    ploverSocketReadyReject = null;
  }
  for (const [, { reject }] of ploverPending) {
    reject(error);
  }
  ploverPending.clear();
  strippedPlover.available = false;
  strippedPlover.enabled = false;
  strippedPlover.solo = false;
  strippedPlover.preeditIndex = null;
  ploverDictionarySignature = "";
  ploverDictionaries = [];
  renderPloverDictionaries();
  updatePloverStatusUI();
  schedulePloverStatusRetry();
}

function ensurePloverSocket() {
  if (androidPloverBridge) {
    return Promise.reject(
      new Error("Android uses its native Stripped Plover bridge"),
    );
  }
  if (ploverSocketReady) return ploverSocketReady;
  ploverSocketReady = new Promise((resolve, reject) => {
    ploverSocketReadyReject = reject;
    const protocol = location.protocol === "https:" ? "wss://" : "ws://";
    const ws = new WebSocket(`${protocol}${location.host}/plover/ws`);
    ploverSocket = ws;

    ws.addEventListener("open", () => {
      strippedPlover.available = true;
      updatePloverStatusUI();
      resolve(ws);
    });
    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!data.id) {
          const dictionaries = data?.dictionaries || data?.result?.dictionaries;
          if (Array.isArray(dictionaries)) {
            if (typeof data.solo === "boolean") {
              strippedPlover.solo = data.solo;
            } else if (typeof data?.result?.solo === "boolean") {
              strippedPlover.solo = data.result.solo;
            }
            updatePloverDictionaries(dictionaries);
            setPloverMessage("");
          }
          return;
        }
        const key = JSON.stringify(data.id);
        const pending = ploverPending.get(key);
        if (pending) {
          ploverPending.delete(key);
          if (data.ok) {
            pending.resolve(data.result);
          } else {
            pending.reject(new Error(data.error || "Stripped Plover error"));
          }
        }
      } catch (e) {
        // Ignore malformed messages
      }
    });
    ws.addEventListener("close", () => {
      resetPloverSocket("Stripped Plover connection closed");
    });
    ws.addEventListener("error", (e) => {
      resetPloverSocket("Stripped Plover WebSocket error");
      reject(new Error("Failed to connect to Stripped Plover"));
    });
  });
  return ploverSocketReady;
}

async function ploverRpc(method, params) {
  if (androidPloverBridge) {
    return requestAndroidPlover(method, params);
  }
  const socket = await ensurePloverSocket();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Stripped Plover unavailable");
  }
  const id = ploverRpcId++;
  const payload = { id, method, params };
  const promise = new Promise((resolve, reject) => {
    const key = JSON.stringify(id);
    socket.send(JSON.stringify(payload));
    ploverPending.set(key, { resolve, reject });
  });
  return promise;
}

function clearPloverPreedit() {
  if (strippedPlover.preeditIndex !== null) {
    const index = strippedPlover.preeditIndex;
    if (index >= 0 && index < buffer.getIslandCount()) {
      buffer.removeIslandAt(index);
    }
    strippedPlover.preeditIndex = null;
  }
}

function syncPloverPreeditIndex() {
  const islands = buffer.getIslands();
  strippedPlover.preeditIndex = null;
  for (let i = islands.length - 1; i >= 0; i--) {
    if (islands[i]?.ploverPreedit) {
      strippedPlover.preeditIndex = i;
      break;
    }
  }
}

function finalizePloverPreedit() {
  if (strippedPlover.preeditIndex !== null) {
    const index = strippedPlover.preeditIndex;
    if (index >= 0 && index < buffer.getIslandCount()) {
      const island = buffer.getIslandAt(index);
      if (island) {
        buffer.replaceIslandAt(index, { ...island, ploverPreedit: false });
      }
    }
    strippedPlover.preeditIndex = null;
  }
}

function applyPloverOutput(
  output,
  { recordHistory, allowInference, finalizePreedit },
) {
  if (!Array.isArray(output)) return;
  const committedParts = [];
  let preeditText = "";
  const hadPreedit = strippedPlover.preeditIndex !== null;
  for (const item of output) {
    if (item.type === "committed") {
      committedParts.push(item.text || "");
    } else if (item.type === "preedit") {
      preeditText = item.text || "";
    }
  }

  const committedJoined = committedParts.join("");
  const combinedCommitted = finalizePreedit
    ? `${committedJoined}${preeditText}`
    : committedJoined;
  const committedText = ensureString(combinedCommitted);
  const normalizedPreedit = finalizePreedit ? "" : ensureString(preeditText);
  const shouldSave =
    hadPreedit || committedText !== "" || normalizedPreedit !== "";
  if (shouldSave) {
    piecemealCursorIndex = null;
    undoManager.savePlover({ recordHistory: !!recordHistory, hadPreedit });
  }

  clearPloverPreedit();

  if (committedText) {
    buffer.appendIsland(
      createIsland("vietnamese", committedText, false, { plover: true }),
    );
  }

  if (!finalizePreedit) {
    if (normalizedPreedit) {
      buffer.appendIsland(
        createIsland("vietnamese", normalizedPreedit, false, {
          plover: true,
          ploverPreedit: true,
        }),
      );
      strippedPlover.preeditIndex = buffer.getIslandCount() - 1;
    }
  }

  state.candidates = [];
  updateDisplay();
  if (allowInference) {
    runInference();
  }
}

async function handlePloverStroke(stroke, { oneShot }) {
  if (!strippedPlover.available || androidPloverPaused) return;
  const currentRequest = ++strippedPlover.requestId;
  try {
    const result = await ploverRpc("translate", { stroke });
    if (currentRequest !== strippedPlover.requestId) return;
    applyPloverOutput(result.output || [], {
      recordHistory: oneShot,
      allowInference: true,
      finalizePreedit: oneShot,
    });
    if (oneShot) {
      await ploverRpc("reset_state", {});
    }
  } catch (e) {
    if (currentRequest !== strippedPlover.requestId) return;
    console.log(e);
    setPloverMessage(e.message || "Stripped Plover request failed.");
  }
}

async function togglePloverMode() {
  if (!strippedPlover.available || androidPloverPaused) return;
  strippedPlover.enabled = !strippedPlover.enabled;
  setPloverMessage("");
  if (!strippedPlover.enabled) {
    finalizePloverPreedit();
    try {
      await ploverRpc("reset_state", {});
    } catch (e) {
      console.log(e);
      setPloverMessage(e.message || "Failed to reset Stripped Plover.");
    }
    runInference();
  } else {
    runInference();
  }
  updatePloverStatusUI();
  updateDisplay();
}

async function refreshPloverDictionaries({ force = false } = {}) {
  if (!strippedPlover.available) return;
  try {
    const result = await ploverRpc("get_dictionary_state", {});
    strippedPlover.solo = !!result.solo;
    const dictionaries = result.dictionaries || [];
    updatePloverDictionaries(dictionaries, { force });
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(e.message || "Failed to load dictionaries.");
  }
}

async function createBlankJsonDictionary(button: HTMLElement) {
  if (!strippedPlover.available) {
    setPloverMessage("Stripped Plover is unavailable.");
    return;
  }
  const nameInput = document.getElementById(
    "plover-new-dictionary-name",
  ) as HTMLInputElement | null;
  let name = (nameInput?.value || "").trim();
  if (!name) {
    setPloverMessage("Enter a name for the blank dictionary.");
    nameInput?.focus();
    return;
  }
  if (!name.toLowerCase().endsWith(".json")) {
    name += ".json";
  }
  if (
    ploverDictionaries.some(
      (dictionary) =>
        dictionary.identifier.toLowerCase() === name.toLowerCase(),
    )
  ) {
    setPloverMessage(`Dictionary "${name}" already exists.`);
    return;
  }

  setButtonLoading(button, true, "Creating...");
  try {
    await ploverRpc("import_dictionary", {
      name,
      type: "json",
      data: {},
      merge: false,
    });
    if (nameInput) nameInput.value = "";
    await refreshPloverDictionaries({ force: true });
    setPloverMessage("");
  } catch (error) {
    console.error(error);
    setPloverMessage(
      error instanceof Error
        ? error.message
        : "Failed to create the blank dictionary.",
    );
  } finally {
    setButtonLoading(button, false, "");
  }
}

function updatePloverDictionarySelects() {
  const editSelectEl = document.getElementById("plover-entry-dict");
  const searchSelectEl = document.getElementById("plover-entry-search-dict");
  const availableDictionaries = ploverDictionaries;

  if (editSelectEl) {
    const previousValue = editSelectEl.value || "";
    editSelectEl.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    if (availableDictionaries.length === 0) {
      placeholder.textContent = "No dictionaries available";
    } else {
      placeholder.textContent = "Select a dictionary";
    }
    placeholder.disabled = true;
    editSelectEl.appendChild(placeholder);
    let selectedValueFound = false;
    for (const dict of availableDictionaries) {
      const option = document.createElement("option");
      option.value = dict.identifier;
      option.textContent = dict.readonly
        ? `${dict.identifier} (read-only)`
        : dict.identifier;
      if (dict.identifier === previousValue) {
        option.selected = true;
        selectedValueFound = true;
      }
      editSelectEl.appendChild(option);
    }
    placeholder.selected = !selectedValueFound;
    editSelectEl.disabled = availableDictionaries.length === 0;
  }

  if (searchSelectEl) {
    const previousValue = searchSelectEl.value || "";
    searchSelectEl.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All dictionaries";
    allOption.selected = previousValue === "";
    searchSelectEl.appendChild(allOption);
    for (const dict of availableDictionaries) {
      const option = document.createElement("option");
      option.value = dict.identifier;
      option.textContent = dict.identifier;
      if (dict.identifier === previousValue) {
        option.selected = true;
      }
      searchSelectEl.appendChild(option);
    }
    searchSelectEl.disabled = !strippedPlover.available;
  }
  updateEntryControls();
}

function updateEntryControls() {
  const selectEl = document.getElementById("plover-entry-dict");
  const addButton = document.getElementById("plover-entry-add");
  const updateButton = document.getElementById("plover-entry-update");
  const removeButton = document.getElementById("plover-entry-remove");
  if (!selectEl || !addButton || !updateButton || !removeButton) return;
  const selectedId = selectEl.value || "";
  const selectedDict = selectedId
    ? ploverDictionaries.find((dict) => dict.identifier === selectedId)
    : null;
  const canEdit = !!selectedDict && !selectedDict.readonly;
  const shouldEnable = strippedPlover.available && canEdit;
  addButton.disabled = !shouldEnable;
  updateButton.disabled = !shouldEnable;
  removeButton.disabled = !shouldEnable;
  if (!strippedPlover.available) {
    setEntryMessage("Stripped Plover is unavailable.");
  } else if (!selectedDict) {
    setEntryMessage(
      selectEl.disabled
        ? "No dictionaries available."
        : "Select a dictionary to edit entries.",
    );
  } else if (selectedDict.readonly) {
    setEntryMessage("Selected dictionary is read-only.");
  } else {
    setEntryMessage("");
  }
}

function getDictionaryFilename(dict, extension) {
  const rawName = dict.identifier;
  const base = rawName.split("/").pop() || "dictionary";
  const safeBase = base.replace(/[\\/:*?"<>|]+/g, "-");
  return extension ? `${safeBase}.${extension}` : safeBase;
}

function inferDictionaryImportType(
  file: File | null | undefined,
): "json" | "python" | null {
  if (!file) return null;
  const filename = file.name.toLowerCase();
  if (filename.endsWith(".py")) return "python";
  if (filename.endsWith(".json")) return "json";

  const mimeType = file.type.toLowerCase().split(";", 1)[0].trim();
  if (
    mimeType === "application/x-python" ||
    mimeType === "application/python" ||
    mimeType === "text/x-python" ||
    mimeType === "text/python"
  ) {
    return "python";
  }
  if (
    mimeType === "application/json" ||
    mimeType === "application/x-json" ||
    mimeType === "text/json"
  ) {
    return "json";
  }
  return null;
}

function readDictionaryFile(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error || new Error("Unable to read the dictionary file.")),
    );
    reader.readAsText(file);
  });
}

interface AndroidDictionaryImportState {
  id: string;
  name: string;
  status: "queued" | "running" | "succeeded" | "failed";
  message: string;
  phase?: string;
  current?: number;
  total?: number;
  percent?: number;
}

function renderAndroidDictionaryImportState(
  state: AndroidDictionaryImportState,
): void {
  const status = document.getElementById("plover-import-status");
  if (!status) return;
  status.hidden = false;
  status.className = `plover-import-status ${
    state.status === "queued" ? "running" : state.status
  }`;
  const copy = status.querySelector<HTMLElement>(".plover-import-status-copy");
  const progress = status.querySelector<HTMLProgressElement>(
    "#plover-import-progress",
  );
  const prefix =
    state.status === "succeeded"
      ? "Imported"
      : state.status === "failed"
        ? "Import failed"
        : "Importing";
  const text = `${prefix} ${state.name}. ${state.message}${
    state.status === "queued" || state.status === "running"
      ? " You can close this screen; import will continue in the background."
      : ""
  }`;
  if (copy) copy.textContent = text;
  if (progress) {
    const percent = Math.max(0, Math.min(100, state.percent ?? 0));
    progress.value = percent;
    progress.hidden = state.status === "failed";
    progress.setAttribute(
      "aria-valuetext",
      `${percent}% · ${state.phase || prefix}`,
    );
  }
}

function pollAndroidDictionaryImport(taskId = androidDictionaryImportTaskId) {
  if (!androidDictionary?.getDictionaryImportState) return;
  if (androidDictionaryImportTimer) {
    window.clearTimeout(androidDictionaryImportTimer);
    androidDictionaryImportTimer = null;
  }
  try {
    const raw = androidDictionary.getDictionaryImportState(taskId);
    if (!raw) return;
    const state = JSON.parse(raw) as AndroidDictionaryImportState;
    androidDictionaryImportTaskId = state.id;
    renderAndroidDictionaryImportState(state);
    if (state.status === "queued" || state.status === "running") {
      androidDictionaryImportTimer = window.setTimeout(
        () => pollAndroidDictionaryImport(state.id),
        1000,
      );
    } else if (state.status === "succeeded") {
      void refreshPloverDictionaries({ force: true }).then(() =>
        runEntrySearch({ page: 1 }),
      );
    }
  } catch (error) {
    setPloverMessage(
      error instanceof Error ? error.message : "Could not read import status.",
    );
  }
}

function enqueueAndroidDictionaryImport(
  name: string,
  type: string,
  content: string,
  merge: boolean,
): boolean {
  const enqueue = androidDictionary?.enqueueSelectedDictionaryImport
    ? () =>
        androidDictionary.enqueueSelectedDictionaryImport!(name, type, merge)
    : androidDictionary?.enqueueDictionaryImport
      ? () =>
          androidDictionary.enqueueDictionaryImport!(name, type, content, merge)
      : null;
  if (!enqueue) return false;
  const result = JSON.parse(enqueue()) as { id?: string; error?: string };
  if (result.error || !result.id) {
    throw new Error(
      result.error || "Could not schedule the dictionary import.",
    );
  }
  androidDictionaryImportTaskId = result.id;
  pollAndroidDictionaryImport(result.id);
  return true;
}

function downloadDictionaryFile(filename, content, mimeType) {
  if (androidDictionary) {
    androidDictionary.saveDictionaryFile(filename, content, mimeType);
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportDictionary(dict, button) {
  const name = dict.identifier;
  if (!name) return;
  setButtonLoading(button, true, "Exporting...");
  try {
    const result = await ploverRpc("export_dictionary", { name });
    const type = result.type || "json";
    if (type === "python") {
      const filename = getDictionaryFilename(dict, "py");
      downloadDictionaryFile(
        filename,
        result.pythonCode || "",
        "text/x-python",
      );
    } else {
      const filename = getDictionaryFilename(dict, "json");
      const data = JSON.stringify(result.data || {}, null, 2);
      downloadDictionaryFile(filename, data, "application/json");
    }
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(e.message || "Failed to export dictionary.");
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function renameDictionary(dict, button) {
  const name = dict.identifier;
  const currentLabel = dict.identifier;
  if (!name) return;
  const nextName = window.prompt("Rename dictionary", currentLabel);
  if (!nextName || nextName.trim() === "" || nextName.trim() === currentLabel)
    return;
  setButtonLoading(button, true, "Renaming...");
  try {
    const renamed = nextName.trim();
    const exported = await ploverRpc("export_dictionary", { name });
    if (exported.type === "python") {
      await ploverRpc("import_dictionary", {
        name: renamed,
        type: "python",
        pythonCode: exported.pythonCode || "",
      });
    } else {
      await ploverRpc("import_dictionary", {
        name: renamed,
        type: "json",
        data: exported.data || {},
        merge: false,
      });
    }
    if (!dict.enabled) {
      await ploverRpc("set_dictionary_enabled", {
        identifier: renamed,
        enabled: false,
      });
    }
    await ploverRpc("remove_dictionary", { name });
    await refreshPloverDictionaries({ force: true });
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(e.message || "Failed to rename dictionary.");
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function deleteDictionary(dict, button) {
  const name = dict.identifier;
  if (!name) return;
  if (!window.confirm(`Delete dictionary "${dict.identifier}"?`)) return;
  setButtonLoading(button, true, "Deleting...");
  try {
    await ploverRpc("remove_dictionary", { name });
    await refreshPloverDictionaries({ force: true });
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(e.message || "Failed to delete dictionary.");
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function setDictionaryEnabled(dict, enabled, button) {
  const identifier = dict.identifier;
  if (!identifier) return;
  setButtonLoading(button, true, enabled ? "Enabling..." : "Disabling...");
  try {
    const result = await ploverRpc("set_dictionary_enabled", {
      identifier,
      enabled,
    });
    const dictionaries = result.dictionaries || null;
    if (Array.isArray(dictionaries)) {
      updatePloverDictionaries(dictionaries, { force: true });
    } else {
      await refreshPloverDictionaries({ force: true });
    }
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(e.message || "Failed to update dictionary state.");
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function prioritizeDictionaryOrder(identifiers, button) {
  if (identifiers.length === 0) return;
  setButtonLoading(button, true, "Moving...");
  try {
    const result = await ploverRpc("prioritize_dictionaries", { identifiers });
    updatePloverDictionaries(result.dictionaries || [], { force: true });
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(e.message || "Failed to reorder dictionaries.");
  } finally {
    setButtonLoading(button, false, "");
  }
}

function getMovedDictionaryOrder(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= ploverDictionaries.length) return null;
  const identifiers = ploverDictionaries.map((dict) => dict.identifier);
  const [identifier] = identifiers.splice(index, 1);
  identifiers.splice(nextIndex, 0, identifier);
  return identifiers;
}

async function soloDictionary(dict, button) {
  const identifier = dict.identifier;
  if (!identifier) return;
  setButtonLoading(button, true, "Solo...");
  try {
    const result = await ploverRpc("solo_dictionaries", {
      toggles: [`+${identifier}`],
    });
    strippedPlover.solo = !!result.solo;
    updatePloverDictionaries(result.dictionaries || [], { force: true });
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(e.message || "Failed to solo dictionary.");
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function endSoloDictionaries(button) {
  setButtonLoading(button, true, "Ending...");
  try {
    const result = await ploverRpc("end_solo_dictionaries", {});
    strippedPlover.solo = !!result.solo;
    updatePloverDictionaries(result.dictionaries || [], { force: true });
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(e.message || "Failed to end solo mode.");
  } finally {
    setButtonLoading(button, false, "");
  }
}

function createDictionaryActionOption(value, label, disabled = false) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.disabled = disabled;
  return option;
}

async function runDictionaryAction(dict, index, action, control) {
  if (action === "enable") {
    await setDictionaryEnabled(dict, true, control);
  } else if (action === "disable") {
    await setDictionaryEnabled(dict, false, control);
  } else if (action === "up") {
    const order = getMovedDictionaryOrder(index, -1);
    if (order) await prioritizeDictionaryOrder(order, control);
  } else if (action === "down") {
    const order = getMovedDictionaryOrder(index, 1);
    if (order) await prioritizeDictionaryOrder(order, control);
  } else if (action === "solo") {
    await soloDictionary(dict, control);
  } else if (action === "export") {
    await exportDictionary(dict, control);
  } else if (action === "rename") {
    await renameDictionary(dict, control);
  } else if (action === "delete") {
    await deleteDictionary(dict, control);
  }
}

function openDictionaryEntries(dict) {
  const identifier = dict.identifier;
  if (!identifier) return;

  const searchSelect = document.getElementById(
    "plover-entry-search-dict",
  ) as HTMLSelectElement | null;
  const editSelect = document.getElementById(
    "plover-entry-dict",
  ) as HTMLSelectElement | null;
  const strokeSearch = document.getElementById(
    "plover-entry-search-stroke",
  ) as HTMLInputElement | null;
  const outputSearch = document.getElementById(
    "plover-entry-search-output",
  ) as HTMLInputElement | null;

  if (searchSelect) searchSelect.value = identifier;
  if (editSelect) editSelect.value = identifier;
  if (strokeSearch) strokeSearch.value = "";
  if (outputSearch) outputSearch.value = "";
  updateEntryControls();

  document.getElementById("plover-tab-entries")?.click();
  const content = document.querySelector<HTMLElement>(".plover-dialog-content");
  if (content) content.scrollTop = 0;
}

function renderPloverDictionaries() {
  const listEl = document.getElementById("plover-dictionary-list");
  if (!listEl) return;
  updatePloverSoloUI();
  listEl.replaceChildren();
  if (!strippedPlover.available) {
    const div = document.createElement("div");
    div.textContent = "Stripped Plover is unavailable.";
    listEl.appendChild(div);
    updatePloverDictionarySelects();
    return;
  }
  if (ploverDictionaries.length === 0) {
    const div = document.createElement("div");
    div.textContent = "No dictionaries loaded.";
    listEl.appendChild(div);
    updatePloverDictionarySelects();
    return;
  }
  ploverDictionaries.forEach((dict, index) => {
    const row = document.createElement("div");
    row.className = "plover-dictionary-item";
    const info = document.createElement("div");
    info.className = "plover-dictionary-info";
    const name = dict.identifier;
    const title = document.createElement("div");
    title.className = "plover-dictionary-title";
    const nameEl = document.createElement("div");
    nameEl.className = "plover-dictionary-name";
    nameEl.textContent = name;
    title.appendChild(nameEl);
    const enabledBadge = document.createElement("span");
    enabledBadge.className = dict.enabled
      ? "plover-badge enabled"
      : "plover-badge disabled";
    enabledBadge.textContent = dict.enabled ? "enabled" : "disabled";
    title.appendChild(enabledBadge);
    if (dict.readonly) {
      const readonlyBadge = document.createElement("span");
      readonlyBadge.className = "plover-badge";
      readonlyBadge.textContent = "read-only";
      title.appendChild(readonlyBadge);
    }
    info.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "plover-dictionary-meta";
    meta.textContent = `${dict.entries ?? 0} entries · priority ${index + 1}`;
    info.appendChild(meta);
    row.appendChild(info);
    const actions = document.createElement("div");
    actions.className = "plover-dictionary-actions";
    const entriesButton = document.createElement("button");
    entriesButton.type = "button";
    entriesButton.className = "plover-dictionary-entries";
    entriesButton.textContent = dict.readonly
      ? "View entries"
      : "View / edit entries";
    entriesButton.addEventListener("click", () => {
      openDictionaryEntries(dict);
    });
    const actionSelect = document.createElement("select");
    actionSelect.setAttribute("aria-label", `Actions for ${dict.identifier}`);
    actionSelect.appendChild(createDictionaryActionOption("", "Actions"));
    actionSelect.appendChild(
      createDictionaryActionOption(
        dict.enabled ? "disable" : "enable",
        dict.enabled ? "Disable" : "Enable",
      ),
    );
    actionSelect.appendChild(createDictionaryActionOption("solo", "Solo"));
    actionSelect.appendChild(
      createDictionaryActionOption("up", "Move up", index === 0),
    );
    actionSelect.appendChild(
      createDictionaryActionOption(
        "down",
        "Move down",
        index === ploverDictionaries.length - 1,
      ),
    );
    actionSelect.appendChild(createDictionaryActionOption("export", "Export"));
    actionSelect.appendChild(
      createDictionaryActionOption("rename", "Rename", !!dict.readonly),
    );
    actionSelect.appendChild(
      createDictionaryActionOption("delete", "Delete", !!dict.readonly),
    );
    actionSelect.addEventListener("change", () => {
      const action = actionSelect.value;
      if (!action) return;
      void runDictionaryAction(dict, index, action, actionSelect);
    });
    actions.appendChild(entriesButton);
    actions.appendChild(actionSelect);
    row.appendChild(actions);
    listEl.appendChild(row);
  });
  updatePloverDictionarySelects();
}

function fillEntryEditor(entry) {
  const dictSelect = document.getElementById("plover-entry-dict");
  const strokeInput = document.getElementById("plover-entry-stroke");
  const translationInput = document.getElementById("plover-entry-translation");
  if (dictSelect && entry.dictionary) {
    dictSelect.value = entry.dictionary;
  }
  if (strokeInput) {
    strokeInput.value = entry.stroke || "";
  }
  if (translationInput) {
    translationInput.value = entry.translation || "";
  }
  updateEntryControls();
}

function renderEntryRows(container, entries) {
  container.replaceChildren();
  if (!entries || entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "plover-muted";
    empty.textContent = "No entries found.";
    container.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "plover-entry-result";
    const stroke = document.createElement("span");
    stroke.textContent = entry.stroke || "";
    const translation = document.createElement("span");
    translation.textContent = entry.translation || "";
    const dictionary = document.createElement("span");
    dictionary.className = "muted";
    dictionary.textContent = entry.dictionary || "";
    row.appendChild(stroke);
    row.appendChild(translation);
    row.appendChild(dictionary);
    row.addEventListener("click", () => fillEntryEditor(entry));
    container.appendChild(row);
  }
}

function updateEntryPagination(result) {
  const prevButton = document.getElementById("plover-entry-prev");
  const nextButton = document.getElementById("plover-entry-next");
  const pageEl = document.getElementById("plover-entry-page");
  ploverEntrySearchHasMore = !!result?.has_more;
  if (prevButton) {
    prevButton.disabled = ploverEntrySearchPage <= 1;
  }
  if (nextButton) {
    nextButton.disabled = !ploverEntrySearchHasMore;
  }
  if (pageEl) {
    const total = result?.total ?? 0;
    pageEl.textContent = `Page ${ploverEntrySearchPage} · ${total} entries`;
  }
}

function getEntrySearchParams(page) {
  const dictSelect = document.getElementById("plover-entry-search-dict");
  const strokeInput = document.getElementById("plover-entry-search-stroke");
  const outputInput = document.getElementById("plover-entry-search-output");
  const matchSelect = document.getElementById("plover-entry-search-match");
  const sortSelect = document.getElementById("plover-entry-sort");
  const dictionary = (dictSelect?.value || "").trim();
  const stroke = (strokeInput?.value || "").trim();
  const output = (outputInput?.value || "").trim();
  const params = {
    page,
    page_size: PLOVER_ENTRY_PAGE_SIZE,
    sort: sortSelect?.value || "alphabetic",
  };
  if (dictionary) params.dictionary = dictionary;
  if (stroke) params.stroke = stroke;
  if (output) params.output = output;
  if (stroke || output) {
    params.match = matchSelect?.value || "substring";
  }
  return { params, hasSearchQuery: !!(stroke || output) };
}

async function runEntrySearch({ page = 1, button = null } = {}) {
  if (!strippedPlover.available) {
    setEntryMessage("Stripped Plover is unavailable.");
    return;
  }
  const resultsEl = document.getElementById("plover-entry-results");
  if (!resultsEl) return;
  if (button) {
    setButtonLoading(button, true, "Searching...");
  }
  try {
    const { params, hasSearchQuery } = getEntrySearchParams(page);
    const method = hasSearchQuery ? "search_entries" : "enumerate_entries";
    const result = await ploverRpc(method, params);
    ploverEntrySearchPage = result.page || page;
    renderEntryRows(resultsEl, result.entries || []);
    updateEntryPagination(result);
    setEntryMessage("");
  } catch (e) {
    console.log(e);
    setEntryMessage(e.message || "Entry search failed.");
  } finally {
    if (button) {
      setButtonLoading(button, false, "");
    }
  }
}

function renderLookupRows(entries) {
  const resultsEl = document.getElementById("plover-lookup-results");
  if (!resultsEl) return;
  renderEntryRows(resultsEl, entries);
}

async function runStrokeLookup(button) {
  if (!strippedPlover.available) {
    setLookupMessage("Stripped Plover is unavailable.");
    return;
  }
  const strokeInput = document.getElementById("plover-lookup-stroke");
  const stroke = (strokeInput?.value || "").trim();
  if (!stroke) {
    setLookupMessage("Provide a stroke to look up.");
    return;
  }
  setButtonLoading(button, true, "Looking...");
  try {
    const result = await ploverRpc("lookup", { stroke });
    renderLookupRows(
      result.translation
        ? [
            {
              stroke: result.stroke || stroke,
              translation: result.translation,
              dictionary: "active dictionaries",
            },
          ]
        : [],
    );
    setLookupMessage(result.translation ? "" : "No translation found.");
  } catch (e) {
    console.log(e);
    setLookupMessage(e.message || "Stroke lookup failed.");
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function runReverseLookup(button) {
  if (!strippedPlover.available) {
    setLookupMessage("Stripped Plover is unavailable.");
    return;
  }
  const translationInput = document.getElementById("plover-lookup-translation");
  const translation = (translationInput?.value || "").trim();
  if (!translation) {
    setLookupMessage("Provide a translation to look up.");
    return;
  }
  setButtonLoading(button, true, "Looking...");
  try {
    const result = await ploverRpc("reverse_lookup", { translation });
    const entries = (result.strokes || []).map((stroke) => ({
      stroke,
      translation: result.translation || translation,
      dictionary: "active dictionaries",
    }));
    renderLookupRows(entries);
    setLookupMessage(entries.length > 0 ? "" : "No strokes found.");
  } catch (e) {
    console.log(e);
    setLookupMessage(e.message || "Reverse lookup failed.");
  } finally {
    setButtonLoading(button, false, "");
  }
}

// --- Logic ---

function appendText(text) {
  if (state.pendingCapitalization && text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    state.pendingCapitalization = false;
  }
  // Append a new Vietnamese (generic text) island
  buffer.appendIsland(createIsland("vietnamese", text));
}

function abortInferenceRequest(clearController) {
  if (inferenceAbortController) {
    inferenceAbortController.abort();
    if (clearController) {
      inferenceAbortController = null;
    }
  }
}

function isStaleInference(controller) {
  return controller && controller !== inferenceAbortController;
}

async function handleChord(stroke) {
  window.dispatchEvent(
    new CustomEvent("v7-editor-stroke", {
      detail: { stroke },
    }),
  );
  if (androidRawOutlineMode) {
    abortInferenceRequest(true);
    const currentOutline = renderVisibleText(state.islands, []);
    if (stroke === "*") {
      const strokes = currentOutline ? currentOutline.split("/") : [];
      strokes.pop();
      const previousOutline = strokes.join("/");
      buffer.setIslands(
        previousOutline ? [createIsland("vietnamese", previousOutline)] : [],
      );
      if (!currentOutline) {
        androidIme?.undoRawOutlineStroke?.();
      }
      state.candidates = [];
      piecemealCursorIndex = null;
      updateDisplay();
      return;
    }
    buffer.setIslands([
      createIsland(
        "vietnamese",
        currentOutline ? `${currentOutline}/${stroke}` : stroke,
      ),
    ]);
    state.candidates = [];
    piecemealCursorIndex = null;
    updateDisplay();
    return;
  }

  // On Android, Q+A on the physical QWERTY keyboard serializes to #S.
  // It is reserved for choosing another IME and is not a V7/Plover stroke.
  if (androidIme && (stroke === "#S-" || stroke === "#S")) {
    androidIme.changeInputMethod();
    return;
  }

  if (stroke === "#") {
    await togglePloverMode();
    return;
  }

  if (strippedPlover.enabled) {
    await handlePloverStroke(stroke, { oneShot: false });
    return;
  }

  // 1. Escape Hatch: #S
  if (!strippedDisplay.enabled && (stroke === "#S-" || stroke === "#S")) {
    if (state.candidates.length > 0) {
      selectCandidate(0); // Select top candidate
    }
    piecemealCursorIndex = null;
    isRawMode = true;
    buffer.clearHistory();
    updateDisplay();
    const textArea = document.getElementById("text-input");
    if (textArea) {
      textArea.focus();
      textArea.selectionStart = textArea.value.length;
      textArea.selectionEnd = textArea.value.length;
    }
    return;
  }

  if (stroke === "*") {
    piecemealCursorIndex = null;
    restoreState();
    return;
  }

  let suppressPiecemealEntry = false;
  if (piecemealCursorIndex !== null) {
    const entryIndex = getPiecemealEntryIndex(stroke);
    if (entryIndex !== null) {
      const targets = findPiecemealSyllableTargets(state.islands);
      if (targets[entryIndex]) {
        piecemealCursorIndex = entryIndex;
        updateDisplay();
        return;
      }
    }

    if (
      state.candidates.length === 0 &&
      isLoneCandidateSelectionStroke(stroke)
    ) {
      piecemealCursorIndex = null;
      updateDisplay();
      return;
    }

    // Syllable+T exits piecemeal. With candidates it selects candidate 1 first;
    // without candidates it still appends the syllable normally.
    const firstCandidateAppendStroke = getFirstCandidateAppendStroke(stroke);
    if (firstCandidateAppendStroke && state.candidates.length === 0) {
      const parsedAppend = parse(firstCandidateAppendStroke);
      if (parsedAppend) {
        saveState();
        piecemealCursorIndex = null;
        appendText(assemble(parsedAppend));
        runInference();
        return;
      }
    }

    // Other active candidate-selection chords keep their normal meaning inside piecemeal mode.
    const piecemealSelection =
      state.candidates.length > 0
        ? getCandidateSelectionMatch(stroke, state.candidates.length)
        : null;
    if (piecemealSelection) {
      suppressPiecemealEntry = true;
    } else {
      const parsedPiecemeal = parse(stroke);
      if (parsedPiecemeal) {
        const targets = findPiecemealSyllableTargets(state.islands);
        const target = targets[piecemealCursorIndex];
        if (target) {
          saveState();
          const replacement = assemble(parsedPiecemeal);
          buffer.setIslands(
            replacePiecemealSyllable(state.islands, target, replacement),
          );
          state.candidates = [];
          const nextTargets = findPiecemealSyllableTargets(state.islands);
          piecemealCursorIndex = getNextPiecemealCursorIndex(
            piecemealCursorIndex,
            nextTargets.length,
          );
          runInference();
          return;
        }
      }
      piecemealCursorIndex = null;
      suppressPiecemealEntry = true;
      updateDisplay();
    }
  }

  if (!suppressPiecemealEntry) {
    const entryIndex = getPiecemealEntryIndex(stroke);
    if (entryIndex !== null) {
      const targets = findPiecemealSyllableTargets(state.islands);
      if (targets[entryIndex]) {
        piecemealCursorIndex = entryIndex;
        updateDisplay();
        return;
      }
    }
  }

  // Two-syllable V7 decoding should outrank Emily for overlapping strokes.
  if (stroke.includes("*")) {
    const v7Code = getV7FromStroke(stroke);
    if (v7Code) {
      piecemealCursorIndex = null;
      saveState();
      buffer.appendIsland(createIsland("vietnamese", v7Code, true));
      runInference();
      return;
    }
  }

  // Emily symbols take precedence over single-syllable/ordinary Vietnamese interpretation.
  const emilyResult = handleEmilySymbol(stroke);
  if (emilyResult) {
    const repeatCount = emilyResult.repeat || 1;
    if (emilyResult.retroSpace) {
      if (buffer.getIslandCount() > 0 || emilyResult.capNext) {
        saveState();
        const changed = applyRetroactiveSpace(
          emilyResult.retroSpace,
          repeatCount,
        );
        state.pendingCapitalization = emilyResult.capNext || false;
        if (changed || emilyResult.capNext) {
          runInference();
          updateDisplay();
        }
      }
      return;
    }
    saveState();
    // spacing rules handled by shouldAddSpace; emilyResult.value already includes symbol
    buffer.appendIsland(
      createIsland(emilyResult.type, emilyResult.value, false, {
        leftSpace: emilyResult.leftSpace,
        rightSpace: emilyResult.rightSpace,
        explicitSpacing: emilyResult.explicitSpacing,
      }),
    );
    state.pendingCapitalization = emilyResult.capNext || false;
    piecemealCursorIndex = null;
    runInference();
    updateDisplay();
    return;
  }

  // Check single-stroke selection+syllable first; otherwise let normal handlers run.
  const selection =
    state.candidates.length > 0
      ? getCandidateSelectionMatch(stroke, state.candidates.length)
      : null;
  if (selection && selection.syllableStroke !== null) {
    const combinedPunctuation = PUNCTUATION_MAP[selection.syllableStroke];
    if (combinedPunctuation) {
      saveState();
      if (
        selectCandidate(selection.candidateIndex, {
          saveHistory: false,
          refreshDisplay: false,
        })
      ) {
        piecemealCursorIndex = null;
        buffer.appendIsland(createIsland("punctuation", combinedPunctuation));
        updateDisplay();
        return;
      }
    }
    const parsedSelection = parse(selection.syllableStroke);
    if (parsedSelection) {
      const syllableText = assemble(parsedSelection);
      saveState();
      if (
        selectCandidate(selection.candidateIndex, {
          saveHistory: false,
          refreshDisplay: false,
        })
      ) {
        piecemealCursorIndex = null;
        appendText(syllableText);
        runInference();
        return;
      }
    }
  }

  // 2. Space Stroke: S-P
  if (stroke === "S-P") {
    saveState();
    piecemealCursorIndex = null;
    buffer.appendIsland(createIsland("spacing", " "));
    runInference();
    updateDisplay();
    return;
  }

  // 3. Punctuation
  if (PUNCTUATION_MAP[stroke]) {
    // Auto-select candidate if present
    if (state.candidates.length > 0) {
      selectCandidate(0);
    }

    saveState();
    piecemealCursorIndex = null;
    const punct = PUNCTUATION_MAP[stroke];
    buffer.appendIsland(createIsland("punctuation", punct));
    updateDisplay();
    return;
  }

  const parsed = parse(stroke);
  if (parsed) {
    const text = assemble(parsed);
    saveState();
    piecemealCursorIndex = null;
    appendText(text);
    runInference();
    return;
  }

  const firstCandidateAppendStroke =
    state.candidates.length === 0
      ? getFirstCandidateAppendStroke(stroke)
      : null;
  if (firstCandidateAppendStroke) {
    const parsedAppend = parse(firstCandidateAppendStroke);
    if (parsedAppend) {
      saveState();
      piecemealCursorIndex = null;
      appendText(assemble(parsedAppend));
      runInference();
      return;
    }
  }

  if (selection && selection.syllableStroke === null) {
    selectCandidate(selection.candidateIndex);
    return;
  }

  if (strippedPlover.available) {
    await handlePloverStroke(stroke, { oneShot: true });
    return;
  }

  console.log("Ignored stroke:", stroke);
}

async function runInference() {
  // Optimization: If no V7 islands, skip inference
  const hasV7 = state.islands.some((i) => i.isV7);
  if (!hasV7) {
    abortInferenceRequest(true);
    state.candidates = [];
    inferenceErrorMessage =
      androidIme && inferenceModelState === "error"
        ? androidIme.getInferenceModelError()
        : "";
    updateDisplay();
    return;
  }

  abortInferenceRequest(false);
  const controller = hasAbortController ? new AbortController() : null;
  inferenceAbortController = controller;

  // Candidates from the previous buffer are no longer valid while this request
  // is in flight. On Android, hardware-key inference is synchronous once the
  // model is ready, so avoid flashing raw V7 between the keystroke and the
  // native result. Raw V7 is still useful while the model is loading or after
  // an error, because there may be no imminent inference result to render.
  state.candidates = [];
  if (!shouldDeferAndroidInferenceRender()) {
    updateDisplay();
  }

  try {
    // Convert client islands to server format [Fixed, V7, Fixed...]
    const serverIslands = convertIslandsForInference(state.islands);

    const requestBody = JSON.stringify({ islands: serverIslands });
    let data;
    if (androidIme) {
      data = await requestAndroidInference(requestBody, controller?.signal);
    } else {
      const fetchOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
        ...(controller ? { signal: controller.signal } : {}),
      };
      const resp = await fetch("/infer", fetchOptions);
      if (!resp.ok) {
        throw new Error(`Inference server returned HTTP ${resp.status}`);
      }
      data = await resp.json();
    }
    if (isStaleInference(controller)) {
      // A newer inference request has started; discard this response.
      return;
    }
    state.candidates = getInferenceCandidates(data);
    inferenceErrorMessage = "";
    updateDisplay();
  } catch (e) {
    if (e && e.name === "AbortError") {
      return;
    }
    console.error("Inference failed", e);
    inferenceErrorMessage =
      e instanceof Error ? e.message : `Unknown inference error: ${String(e)}`;
    state.candidates = [];
    updateDisplay();
  } finally {
    if (controller && controller === inferenceAbortController) {
      // Only clear if this is still the latest inference request.
      inferenceAbortController = null;
    }
  }
}

function shouldDeferAndroidInferenceRender() {
  return androidIme && inferenceModelState === "ready";
}

function hasOsPassthroughModifier(event) {
  return event.ctrlKey || event.altKey || event.metaKey;
}

function getInferenceCandidates(data: unknown): string[][] {
  if (!data || typeof data !== "object") {
    throw new Error("Inference server returned an invalid response");
  }
  const candidates = (data as { candidates?: unknown }).candidates;
  if (
    !Array.isArray(candidates) ||
    !candidates.every(
      (candidate) =>
        Array.isArray(candidate) &&
        candidate.every((part) => typeof part === "string"),
    )
  ) {
    throw new Error("Inference response is missing valid candidates");
  }
  return candidates;
}

type SelectCandidateOptions = {
  saveHistory: boolean;
  refreshDisplay: boolean;
};

function selectCandidate(
  index,
  options: SelectCandidateOptions = { saveHistory: true, refreshDisplay: true },
) {
  const nextIslands = selectCandidateIslands(
    state.candidates,
    index,
    state.islands,
  );
  if (!nextIslands) return false;
  if (options.saveHistory) {
    saveState();
  }
  buffer.setIslands(nextIslands);
  state.candidates = [];
  piecemealCursorIndex = null;
  if (options.refreshDisplay) {
    updateDisplay();
  }
  return true;
}

function updateInputPadding(display, textArea, candidateArea) {
  if (!display.dataset.basePaddingBottom) {
    display.dataset.basePaddingBottom = String(
      parseFloat(getComputedStyle(display).paddingBottom) || 0,
    );
  }
  if (!textArea.dataset.basePaddingBottom) {
    textArea.dataset.basePaddingBottom = String(
      parseFloat(getComputedStyle(textArea).paddingBottom) || 0,
    );
  }

  const candidateHeight = Math.ceil(
    candidateArea.getBoundingClientRect().height,
  );
  const configuredDisplayBase = parseFloat(
    getComputedStyle(display).getPropertyValue("--input-padding-bottom"),
  );
  const displayBase = Number.isFinite(configuredDisplayBase)
    ? configuredDisplayBase
    : parseFloat(display.dataset.basePaddingBottom) || 0;
  const textAreaBase = parseFloat(textArea.dataset.basePaddingBottom) || 0;

  display.style.paddingBottom = `${
    displayBase + (strippedDisplay.enabled ? 0 : candidateHeight)
  }px`;
  textArea.style.paddingBottom = `${textAreaBase + candidateHeight}px`;
}

function scrollToBottom(element) {
  element.scrollTop = element.scrollHeight;
  requestAnimationFrame(() => {
    element.scrollTop = element.scrollHeight;
  });
}

function formatKeyboardKeyLabel(key) {
  if (key === " ") return "Spacebar";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function renderKeyboardLayout() {
  const board = document.getElementById("qwerty-board");
  if (!board) return;
  board.replaceChildren();

  for (const row of qwertyKeyboardLayout) {
    const rowEl = document.createElement("div");
    rowEl.className = "qwerty-row";
    for (const key of row) {
      const keyEl = document.createElement("div");
      keyEl.className = "qwerty-key";
      keyEl.dataset.key = key.key;
      keyEl.style.setProperty("--key-width", String(key.width ?? 1));
      keyEl.textContent = key.label;
      keyEl.setAttribute("aria-label", `${key.label} key`);
      rowEl.appendChild(keyEl);
    }
    board.appendChild(rowEl);
  }
}

function updateKeyboardLayout() {
  const layout = document.getElementById("keyboard-layout");
  if (!layout) return;

  layout.classList.toggle("visible", isKeyboardLayoutVisible);
  layout.setAttribute(
    "aria-hidden",
    isKeyboardLayoutVisible ? "false" : "true",
  );
  for (const keyEl of layout.querySelectorAll(".qwerty-key")) {
    const key = keyEl.dataset.key || "";
    keyEl.classList.toggle("is-pressed", pressedQwertyKeys.has(key));
  }

  const summary = document.getElementById("keyboard-pressed-summary");
  if (summary) {
    const labels = Array.from(pressedQwertyKeys, formatKeyboardKeyLabel);
    summary.textContent =
      labels.length > 0
        ? labels.join(" + ")
        : isTrainerEmbedded
          ? "Chưa bấm phím"
          : "No keys pressed";
  }
}

function renderVisibleSegmentFragment(segment) {
  const fragment = document.createDocumentFragment();
  if (segment.piecemealNumber === undefined) {
    fragment.appendChild(document.createTextNode(segment.text));
    return fragment;
  }

  const span = document.createElement("span");
  span.className = segment.piecemealCursor
    ? "piecemeal-syllable active"
    : "piecemeal-syllable";
  span.textContent = segment.text;

  const token = document.createElement("span");
  token.className = "piecemeal-token";
  token.appendChild(span);

  if (!segment.piecemealCursor) {
    const sup = document.createElement("sup");
    sup.className = "piecemeal-number";
    sup.textContent = String(segment.piecemealNumber);
    token.appendChild(sup);
  }

  fragment.appendChild(token);
  return fragment;
}

function setKeyboardLayoutVisible(visible) {
  isKeyboardLayoutVisible = visible;
  updateKeyboardLayout();
}

function toggleKeyboardLayout() {
  setKeyboardLayoutVisible(!isKeyboardLayoutVisible);
}

function setupImeControls() {
  const switchKeyboard = document.getElementById("ime-switch-keyboard");
  if (switchKeyboard) {
    if (androidIme) {
      switchKeyboard.addEventListener("click", () => {
        androidIme.changeInputMethod();
      });
    } else {
      switchKeyboard.setAttribute("hidden", "");
    }
  }
}

function updateInferenceStatusUI() {
  const status = document.getElementById("inference-status");
  if (!status || !androidIme) return;
  const labels = {
    missing: "Model missing",
    not_loaded: "Model not loaded",
    loading: "Loading model… · raw buffer",
    ready: "Model ready",
    error: "Model error",
  };
  status.textContent =
    labels[inferenceModelState] ?? `Model ${inferenceModelState}`;
  status.className = `ime-mode-detail ${inferenceModelState}`;
}

function trackQwertyKey(event, isPressed) {
  const key = normalizeQwertyDisplayKey(event.key, event.code || "");
  if (!key) return;
  if (isPressed) {
    pressedQwertyKeys.add(key);
  } else {
    pressedQwertyKeys.delete(key);
  }
  updateKeyboardLayout();
}

function clearPressedQwertyKeys() {
  if (pressedQwertyKeys.size === 0) return;
  pressedQwertyKeys.clear();
  updateKeyboardLayout();
}

function updateDisplay() {
  const display = document.getElementById("text-display");
  const textArea = document.getElementById("text-input");
  const candArea = document.getElementById("candidate-area");
  const inferenceError = document.getElementById("inference-error");

  const text = renderVisibleText(state.islands, state.candidates);
  const candidateDiffPlan =
    state.candidates.length > 0
      ? buildCandidateDiffPlan(state.islands, state.candidates)
      : null;

  document.body.classList.toggle("stripped-display", strippedDisplay.enabled);
  document.body.classList.toggle(
    "android-normal-typing",
    strippedDisplay.enabled &&
      !androidStenoModeEnabled &&
      !androidRawOutlineMode,
  );
  document.body.classList.toggle(
    "android-raw-outline",
    strippedDisplay.enabled && androidRawOutlineMode,
  );
  const modeTitle = document.querySelector<HTMLElement>(".ime-mode-title");
  if (modeTitle && strippedDisplay.enabled) {
    modeTitle.textContent = androidRawOutlineMode
      ? "Raw outline mode"
      : androidStenoModeEnabled
        ? "Compose"
        : "Normal typing";
  }
  document.body.classList.toggle(
    "stripped-plover-active",
    strippedDisplay.enabled &&
      androidStenoModeEnabled &&
      !androidRawOutlineMode &&
      strippedPlover.enabled,
  );
  if (inferenceError) {
    inferenceError.hidden = inferenceErrorMessage === "";
    inferenceError.textContent = inferenceErrorMessage
      ? isTrainerEmbedded
        ? `Không lấy được các cách viết: ${inferenceErrorMessage}`
        : `Inference error: ${inferenceErrorMessage}`
      : "";
  }
  if (strippedDisplay.enabled && candidateDiffPlan?.sections.length) {
    console.info(
      "Candidate diff regions:",
      candidateDiffPlan.sections.map(({ role, start, end }) => ({
        role,
        start,
        end,
      })),
    );
  }

  if (isRawMode) {
    // Raw Mode: Show textarea
    display.style.display = "none";
    textArea.style.display = "block";
    if (textArea.value !== text) {
      // Only update if changed to avoid cursor jumps if loop?
      textArea.value = text;
    }
    candArea.style.display = "none"; // Hide candidates in raw mode? Usually yes.
  } else {
    // Steno Mode: Show div
    display.style.display = "block";
    textArea.style.display = "none";
    const candidatesVisible =
      state.candidates.length > (strippedDisplay.enabled ? 1 : 0);
    candArea.style.display = candidatesVisible ? "flex" : "none";

    // Check if empty (single empty Viet island)
    const isEmpty =
      state.islands.length === 1 &&
      state.islands[0].value === "" &&
      !state.islands[0].isV7;

    display.replaceChildren();
    let textFlow = display;
    if (strippedDisplay.enabled) {
      // Stripped display uses flex layout to anchor the buffer to the bottom.
      // Keep its contents in one normal inline formatting context so text
      // nodes, especially spaces, do not become individual flex items.
      textFlow = document.createElement("div");
      textFlow.className = isEmpty
        ? "text-display-flow empty-text-display-flow"
        : "text-display-flow";
      display.appendChild(textFlow);
    }

    // Fix: Cursor should be at the start if placeholder is present
    const cursor = document.createElement("span");
    cursor.id = "cursor";
    textFlow.appendChild(cursor);

    if (text === "" && isEmpty) {
      const placeholder = document.createElement("span");
      placeholder.textContent = strippedDisplay.enabled
        ? "👋"
        : isTrainerEmbedded
          ? "Bắt đầu gõ bằng bàn phím V7…"
          : "Start typing with your steno keyboard...";
      placeholder.className = strippedDisplay.enabled ? "empty-wave" : "";
      placeholder.style.color = strippedDisplay.enabled ? "" : "#999";
      textFlow.appendChild(placeholder);
    } else {
      let visibleSegments = renderVisibleTextSegments(
        state.islands,
        state.candidates,
        piecemealCursorIndex,
        candidateDiffPlan?.sections ?? [],
      );
      if (strippedDisplay.enabled) {
        visibleSegments = stripVisibleTextSegments(visibleSegments);
      }
      for (const group of groupVisibleTextSegmentsByCandidateSection(
        visibleSegments,
      )) {
        if (group.candidateSection) {
          const sectionSpan = document.createElement("span");
          sectionSpan.className = `candidate-section candidate-section-${group.candidateSection}`;
          for (const segment of group.segments) {
            sectionSpan.appendChild(renderVisibleSegmentFragment(segment));
          }
          textFlow.insertBefore(sectionSpan, cursor);
        } else {
          for (const segment of group.segments) {
            textFlow.insertBefore(
              renderVisibleSegmentFragment(segment),
              cursor,
            );
          }
        }
      }
      display.style.color = "#000";
    }
    // Render Candidates
    candArea.replaceChildren();
    if (candidateDiffPlan && state.candidates.length > 0) {
      const visibleCandidates = candidateDiffPlan.candidates.slice(0, 5);
      const maxSummaryLength = Math.max(
        ...visibleCandidates.map((candidate) => {
          const changedSections = candidate.sections.filter(
            (section) => section.changes,
          );
          if (candidateDiffPlan.sections.length === 0)
            return candidate.text.length;
          if (changedSections.length === 0) return "current".length;
          return changedSections.reduce(
            (sum, section) => sum + Math.max(section.text.length, 7),
            0,
          );
        }),
      );

      const useCompactCandidates =
        candidateDiffPlan.sections.length > 0 && maxSummaryLength < 24;
      candArea.classList.toggle("horizontal", useCompactCandidates);
      candArea.classList.toggle("compact", useCompactCandidates);

      const firstVisibleCandidate = strippedDisplay.enabled ? 1 : 0;
      for (let i = firstVisibleCandidate; i < visibleCandidates.length; i++) {
        const candidate = visibleCandidates[i];
        const div = document.createElement("div");
        div.className = "candidate";

        const sup = document.createElement("sup");
        sup.textContent = i + 1;
        div.appendChild(sup);

        div.appendChild(document.createTextNode(" "));

        const span = document.createElement("span");
        span.className = "candidate-text candidate-diff-summary";
        const changedSections = candidate.sections.filter(
          (section) => section.changes,
        );

        if (candidateDiffPlan.sections.length === 0) {
          span.textContent = candidate.text;
        } else if (changedSections.length === 0) {
          const unchanged = document.createElement("span");
          unchanged.className = "candidate-unchanged";
          unchanged.textContent = "current";
          span.appendChild(unchanged);
        } else {
          for (const section of changedSections) {
            const sectionSpan = document.createElement("span");
            sectionSpan.className = `candidate-section candidate-section-${section.role}`;
            sectionSpan.textContent = section.text || "(empty)";
            span.appendChild(sectionSpan);
          }
        }

        div.appendChild(span);
        div.onclick = () => selectCandidate(i);
        candArea.appendChild(div);
      }
    } else {
      candArea.classList.remove("horizontal");
      candArea.classList.remove("compact");
      const div = document.createElement("div");
      div.className = "candidate";
      div.style.cursor = "default";

      const span = document.createElement("span");
      span.className = "candidate-text";
      span.style.color = "#999";
      span.style.textAlign = "center";
      span.textContent = "No candidates";

      div.appendChild(span);
      candArea.appendChild(div);
    }
  }

  updateInputPadding(display, textArea, candArea);
  scrollToBottom(isRawMode ? textArea : display);
  syncAndroidKeyboardHeight(candArea);
  syncAndroidPreedit(candidateDiffPlan);
  window.dispatchEvent(
    new CustomEvent("v7-editor-state", {
      detail: {
        text,
        candidates: state.candidates
          .slice(0, 5)
          .map((candidate) => candidate.join("")),
        piecemealCursorIndex,
        inferencePending: inferenceAbortController !== null,
        inferenceError: inferenceErrorMessage,
      },
    }),
  );
}

// --- Input Handling ---

const keyboardStrokeTracker = new KeyboardStrokeTracker();

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    clearPressedQwertyKeys();
    if (!e.repeat) {
      toggleKeyboardLayout();
    }
    e.preventDefault();
    return;
  }

  // Global Shortcuts
  if (e.ctrlKey && e.key === "c") {
    clearPressedQwertyKeys();
    // Copy entire buffer if nothing selected
    if (
      (!strippedDisplay.enabled || strippedDisplay.copyAllowed) &&
      !window.getSelection().toString()
    ) {
      const textToCopy = renderVisibleText(state.islands, state.candidates);

      navigator.clipboard.writeText(textToCopy).catch((err) => {
        console.error("Failed to copy: ", err);
      });
      // We can prevent default if we want, but let's allow it to be safe?
      // Actually request says "Ctrl+C copies the whole buffer when nothing is selected."
      // Standard behavior is copy selected.
    }
    return; // Allow default processing
  }

  if (hasOsPassthroughModifier(e)) {
    clearPressedQwertyKeys();
    return;
  }

  trackQwertyKey(e, true);

  if (isDictionaryTextInputFocused(e.target)) {
    return; // Allow normal typing in dictionary text boxes
  }

  if (isRawMode) {
    if (e.key === "Escape") {
      // Exit Raw Mode
      const textArea = document.getElementById("text-input");
      const newText = textArea.value;

      // Update state
      buffer.setIslands([createIsland("vietnamese", newText)]);
      state.candidates = [];
      piecemealCursorIndex = null;
      buffer.clearHistory();
      isRawMode = false;

      updateDisplay();
      e.preventDefault();
    }
    return; // Let other keys pass to textarea
  }

  if (e.repeat) return;

  const ploverActive = strippedPlover.enabled;

  // Handle Literal Uppercase (Shift + Letter) and literal numbers as capitals (only when Plover is disabled)
  if (!ploverActive && e.key.length === 1) {
    const isLetter = e.key.match(/[a-z]/i);
    const isNumber = e.key.match(/[0-9]/);
    if ((e.shiftKey && isLetter) || isNumber) {
      saveState();
      piecemealCursorIndex = null;
      const value = isNumber ? e.key : e.key.toUpperCase();
      buffer.appendIsland(createIsland("capital", value));
      runInference();
      e.preventDefault();
      return;
    }
  }

  // Handle Enter for Newline (only when Plover is disabled)
  if (!ploverActive && e.key === "Enter") {
    if (state.candidates.length > 0) {
      selectCandidate(0);
    }
    piecemealCursorIndex = null;
    buffer.trimTrailingSpaceFromLastVietnameseIsland();
    saveState();
    buffer.appendIsland(createIsland("spacing", "\n"));
    runInference();
    updateDisplay();
    e.preventDefault();
    return;
  }

  const mapped = mapKeyUnique(e.key);
  if (!mapped) return;
  const immediateDigit = !ploverActive && mapped.match(/^[0-9]$/);
  keyboardStrokeTracker.keyDown(e.key, { includeInStroke: !immediateDigit });

  // Numbers should generate immediate capital island, not be part of steno chord
  if (immediateDigit) {
    // Emit as capital/number island immediately
    saveState();
    piecemealCursorIndex = null;
    buffer.appendIsland(createIsland("capital", mapped));
    runInference();
    e.preventDefault();
    return;
  }
  e.preventDefault();
});

document.addEventListener("keyup", (e) => {
  if (hasOsPassthroughModifier(e)) {
    clearPressedQwertyKeys();
    return;
  }

  trackQwertyKey(e, false);

  if (isRawMode) return; // Don't process steno in raw mode

  if (isDictionaryTextInputFocused(e.target)) {
    return;
  }

  const strokeStr = keyboardStrokeTracker.keyUp(e.key);
  if (strokeStr) {
    handleChord(strokeStr).catch((err) => {
      console.error("Stroke handling failed", err);
    });
  }
});

window.addEventListener("blur", clearPressedQwertyKeys);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearPressedQwertyKeys();
  }
});

function setupPloverControls() {
  const dictionaryOpenButton = document.getElementById(
    "plover-dictionary-open",
  );
  const dictionaryDialog = document.getElementById("plover-dictionary-dialog");
  const dictionaryCloseButton = document.getElementById(
    "plover-dictionary-close",
  );
  const refreshButton = document.getElementById("plover-refresh");
  const endSoloButton = document.getElementById("plover-end-solo");
  const createDictionaryButton = document.getElementById(
    "plover-new-dictionary-create",
  );
  const uploadButton = document.getElementById("plover-dict-upload");
  const dictionaryFileInput = document.getElementById(
    "plover-dict-file",
  ) as HTMLInputElement | null;
  const dictionaryTypeSelect = document.getElementById(
    "plover-dict-type",
  ) as HTMLSelectElement | null;
  const entrySearchButton = document.getElementById("plover-entry-search");
  const entryPrevButton = document.getElementById("plover-entry-prev");
  const entryNextButton = document.getElementById("plover-entry-next");
  const lookupStrokeButton = document.getElementById(
    "plover-lookup-stroke-run",
  );
  const lookupTranslationButton = document.getElementById(
    "plover-lookup-translation-run",
  );
  const addButton = document.getElementById("plover-entry-add");
  const updateButton = document.getElementById("plover-entry-update");
  const removeButton = document.getElementById("plover-entry-remove");
  const dictSelect = document.getElementById("plover-entry-dict");

  for (const tab of document.querySelectorAll(".plover-tab")) {
    tab.addEventListener("click", () => {
      const panelId = tab.dataset.panel;
      if (!panelId) return;
      for (const candidate of document.querySelectorAll(".plover-tab")) {
        candidate.classList.toggle("active", candidate === tab);
      }
      for (const panel of document.querySelectorAll(".plover-panel")) {
        panel.classList.toggle("active", panel.id === panelId);
      }
      const content = dictionaryDialog?.querySelector<HTMLElement>(
        ".plover-dialog-content",
      );
      if (content) content.scrollTop = 0;
      if (panelId === "plover-panel-entries") {
        void runEntrySearch({ page: ploverEntrySearchPage });
      }
    });
  }

  if (dictionaryOpenButton && dictionaryDialog) {
    dictionaryOpenButton.addEventListener("click", () => {
      document.body.classList.add("plover-dictionary-open");
      if (typeof dictionaryDialog.showModal === "function") {
        dictionaryDialog.showModal();
      } else {
        dictionaryDialog.setAttribute("open", "");
      }
      void refreshPloverDictionaries({ force: true }).then(() =>
        runEntrySearch({ page: 1 }),
      );
    });
  }
  if (dictionaryCloseButton && dictionaryDialog) {
    dictionaryCloseButton.addEventListener("click", () => {
      if (isDictionaryManagementPage && androidDictionary) {
        androidDictionary.close();
        return;
      }
      if (typeof dictionaryDialog.close === "function") {
        dictionaryDialog.close();
      } else {
        dictionaryDialog.removeAttribute("open");
      }
      document.body.classList.remove("plover-dictionary-open");
      updateDisplay();
    });
  }
  if (dictionaryDialog) {
    dictionaryDialog.addEventListener("click", (event) => {
      if (event.target === dictionaryDialog) {
        if (typeof dictionaryDialog.close === "function") {
          dictionaryDialog.close();
        } else {
          dictionaryDialog.removeAttribute("open");
        }
        document.body.classList.remove("plover-dictionary-open");
        updateDisplay();
      }
    });
    dictionaryDialog.addEventListener("cancel", () => {
      if (isDictionaryManagementPage && androidDictionary) {
        androidDictionary.close();
        return;
      }
      document.body.classList.remove("plover-dictionary-open");
      updateDisplay();
    });
  }
  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      if (!strippedPlover.available) {
        setPloverMessage("Stripped Plover is unavailable.");
        return;
      }
      setButtonLoading(refreshButton, true, "Refreshing...");
      try {
        await refreshPloverDictionaries({ force: true });
      } finally {
        setButtonLoading(refreshButton, false, "");
      }
    });
  }
  if (endSoloButton) {
    endSoloButton.addEventListener("click", () => {
      void endSoloDictionaries(endSoloButton);
    });
  }
  if (createDictionaryButton) {
    createDictionaryButton.addEventListener("click", () => {
      void createBlankJsonDictionary(createDictionaryButton);
    });
  }
  if (dictionaryFileInput && dictionaryTypeSelect) {
    dictionaryFileInput.addEventListener("change", () => {
      const inferredType = inferDictionaryImportType(
        dictionaryFileInput.files?.[0],
      );
      if (inferredType) {
        dictionaryTypeSelect.value = inferredType;
      }
    });
  }
  if (uploadButton) {
    uploadButton.addEventListener("click", async () => {
      if (!strippedPlover.available) {
        setPloverMessage("Stripped Plover is unavailable.");
        return;
      }
      const nameInput = document.getElementById("plover-dict-name");
      const mergeToggle = document.getElementById("plover-dict-merge");
      const file = dictionaryFileInput?.files?.[0];
      if (!file) {
        setPloverMessage("Select a dictionary file to upload.");
        return;
      }
      const name = (nameInput?.value || "").trim() || file.name;
      const type =
        inferDictionaryImportType(file) ||
        dictionaryTypeSelect?.value ||
        "json";
      setButtonLoading(uploadButton, true, "Uploading...");
      try {
        const selectedImport =
          androidDictionary?.enqueueSelectedDictionaryImport;
        const content = selectedImport ? "" : await readDictionaryFile(file);
        if (
          enqueueAndroidDictionaryImport(
            name,
            type,
            content,
            !!mergeToggle?.checked,
          )
        ) {
          if (dictionaryFileInput) dictionaryFileInput.value = "";
          setPloverMessage("");
          return;
        }
        if (type === "json") {
          const data = JSON.parse(content);
          await ploverRpc("import_dictionary", {
            name,
            type: "json",
            data,
            merge: !!mergeToggle?.checked,
          });
        } else {
          await ploverRpc("import_dictionary", {
            name,
            type: "python",
            pythonCode: content,
          });
        }
        await refreshPloverDictionaries({ force: true });
        await runEntrySearch({ page: 1 });
        setPloverMessage("");
      } catch (e) {
        console.log(e);
        setPloverMessage(e.message || "Failed to upload dictionary.");
      } finally {
        setButtonLoading(uploadButton, false, "");
      }
    });
  }
  if (isDictionaryManagementPage) {
    pollAndroidDictionaryImport("");
  }
  if (entrySearchButton) {
    entrySearchButton.addEventListener("click", () => {
      void runEntrySearch({ page: 1, button: entrySearchButton });
    });
  }
  if (entryPrevButton) {
    entryPrevButton.addEventListener("click", () => {
      if (ploverEntrySearchPage > 1) {
        void runEntrySearch({
          page: ploverEntrySearchPage - 1,
          button: entryPrevButton,
        });
      }
    });
  }
  if (entryNextButton) {
    entryNextButton.addEventListener("click", () => {
      if (ploverEntrySearchHasMore) {
        void runEntrySearch({
          page: ploverEntrySearchPage + 1,
          button: entryNextButton,
        });
      }
    });
  }
  if (lookupStrokeButton) {
    lookupStrokeButton.addEventListener("click", () => {
      void runStrokeLookup(lookupStrokeButton);
    });
  }
  if (lookupTranslationButton) {
    lookupTranslationButton.addEventListener("click", () => {
      void runReverseLookup(lookupTranslationButton);
    });
  }

  const entryHandler = async (action) => {
    if (!strippedPlover.available) {
      setEntryMessage("Stripped Plover is unavailable.");
      return;
    }
    const dictSelect = document.getElementById("plover-entry-dict");
    const strokeInput = document.getElementById("plover-entry-stroke");
    const translationInput = document.getElementById(
      "plover-entry-translation",
    );
    const stroke = (strokeInput?.value || "").trim();
    const translation = (translationInput?.value || "").trim();
    const name = (dictSelect?.value || "").trim();
    if (!name) {
      setEntryMessage("Select a dictionary to edit entries.");
      return;
    }
    const selectedDict = ploverDictionaries.find(
      (dict) => dict.identifier === name,
    );
    if (selectedDict?.readonly) {
      setEntryMessage("Selected dictionary is read-only.");
      return;
    }
    if (!stroke) {
      setEntryMessage("Provide a stroke for entry management.");
      return;
    }
    try {
      const params = { name, stroke };
      if (action === "add") {
        if (!translation) {
          setEntryMessage("Provide a translation to add an entry.");
          return;
        }
        await ploverRpc("add_entry", { ...params, translation });
      } else if (action === "update") {
        if (!translation) {
          setEntryMessage("Provide a translation to update an entry.");
          return;
        }
        await ploverRpc("update_entry", { ...params, translation });
      } else if (action === "remove") {
        await ploverRpc("remove_entry", params);
      }
      setEntryMessage("");
      await refreshPloverDictionaries();
      await runEntrySearch({ page: ploverEntrySearchPage });
    } catch (e) {
      console.log(e);
      setEntryMessage(e.message || "Entry update failed.");
    }
  };

  if (addButton) {
    addButton.addEventListener("click", () => {
      void entryHandler("add");
    });
  }
  if (updateButton) {
    updateButton.addEventListener("click", () => {
      void entryHandler("update");
    });
  }
  if (removeButton) {
    removeButton.addEventListener("click", () => {
      void entryHandler("remove");
    });
  }
  if (dictSelect) {
    dictSelect.addEventListener("change", () => {
      updateEntryControls();
    });
  }

  void ensurePloverAvailability().then(() => {
    if (!strippedPlover.available) {
      renderPloverDictionaries();
    }
  });

  if (isDictionaryManagementPage && dictionaryDialog) {
    document.body.classList.add(
      "dictionary-management-page",
      "plover-dictionary-open",
    );
    if (typeof dictionaryDialog.show === "function") {
      dictionaryDialog.show();
    } else {
      dictionaryDialog.setAttribute("open", "");
    }
  }
}

if (isDictionaryManagementPage) {
  mountPloverDictionaryUi();
  setupPloverControls();
} else {
  if (document.getElementById("plover-dictionary-open")) {
    mountPloverDictionaryUi();
  }
  renderKeyboardLayout();
  updateKeyboardLayout();
  setupImeControls();
  setupPloverControls();
}

declare global {
  interface Window {
    AndroidIme?: AndroidImeBridge;
    AndroidDictionary?: AndroidDictionaryBridge;
    clearPreeditFromAndroid?: () => void;
    handleAndroidInferenceState?: (state: string) => void;
    handleAndroidInferenceWarmupError?: (errorMessage: string) => void;
    handleAndroidInferenceResponse?: (
      requestId: number,
      statusCode: number,
      responseBody: string,
      errorMessage: string,
    ) => void;
    handleAndroidPloverResponse?: (
      requestId: number,
      responseBody: string,
      errorMessage: string,
    ) => void;
    handleAndroidPloverPaused?: (paused: boolean) => void;
    handleAndroidRawOutlineModeChanged?: (enabled: boolean) => void;
    handleAndroidStenoModeChanged?: (enabled: boolean) => void;
    handleAndroidKeyEvent?: (
      action: "keydown" | "keyup",
      key: string,
      code: string,
      repeat: boolean,
      shiftKey: boolean,
      ctrlKey: boolean,
      altKey: boolean,
      metaKey: boolean,
    ) => void;
    setStrippedDisplay: (options?: { copyAllowed?: boolean }) => void;
  }
}

function requestAndroidInference(
  body: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!androidIme) {
      reject(new Error("Android IME bridge is unavailable"));
      return;
    }

    const requestId = androidInferenceRequestId++;
    const abort = () => {
      androidInferencePending.delete(requestId);
      reject(new DOMException("Inference request was aborted", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }

    try {
      if (androidIme.requestInferenceSync) {
        const response = JSON.parse(
          androidIme.requestInferenceSync(body, requestId),
        );
        if (response.errorMessage) {
          reject(new Error(String(response.errorMessage)));
          return;
        }
        const statusCode = Number(response.statusCode ?? 0);
        if (statusCode < 200 || statusCode >= 300) {
          reject(
            new Error(
              `Local inference returned status ${statusCode}${
                response.responseBody ? `: ${response.responseBody}` : ""
              }`,
            ),
          );
          return;
        }
        resolve(JSON.parse(String(response.responseBody ?? "")));
        return;
      }

      androidInferencePending.set(requestId, { resolve, reject });
      signal?.addEventListener("abort", abort, { once: true });
      androidIme.requestInference(body, requestId);
    } catch (error) {
      androidInferencePending.delete(requestId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function requestAndroidPlover(
  method: string,
  params: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!androidPloverBridge) {
      reject(new Error("Android Plover bridge is unavailable"));
      return;
    }
    const requestId = androidPloverRequestId++;
    const timeoutId = window.setTimeout(() => {
      if (!androidPloverPending.delete(requestId)) return;
      reject(new Error("Stripped Plover timed out after 180 seconds."));
    }, ANDROID_PLOVER_REQUEST_TIMEOUT_MS);
    androidPloverPending.set(requestId, { resolve, reject, timeoutId });
    try {
      androidPloverBridge.requestPlover(
        JSON.stringify({ id: requestId, method, params }),
        requestId,
      );
    } catch (error) {
      androidPloverPending.delete(requestId);
      window.clearTimeout(timeoutId);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

window.handleAndroidInferenceResponse = (
  requestId,
  statusCode,
  responseBody,
  errorMessage,
) => {
  const pending = androidInferencePending.get(requestId);
  if (!pending) return;
  androidInferencePending.delete(requestId);

  if (errorMessage) {
    pending.reject(new Error(errorMessage));
    return;
  }
  if (statusCode < 200 || statusCode >= 300) {
    pending.reject(
      new Error(
        `Local inference returned status ${statusCode}${
          responseBody ? `: ${responseBody}` : ""
        }`,
      ),
    );
    return;
  }
  try {
    pending.resolve(JSON.parse(responseBody));
  } catch {
    pending.reject(new Error("Local inference returned invalid JSON"));
  }
};

window.handleAndroidInferenceState = (modelState) => {
  inferenceModelState = modelState;
  if (modelState !== "error") {
    inferenceErrorMessage = "";
  }
  updateInferenceStatusUI();
  updateDisplay();
};

window.handleAndroidInferenceWarmupError = (errorMessage) => {
  inferenceErrorMessage = errorMessage;
  updateDisplay();
};

window.handleAndroidPloverResponse = (
  requestId,
  responseBody,
  errorMessage,
) => {
  const pending = androidPloverPending.get(requestId);
  if (!pending) return;
  androidPloverPending.delete(requestId);
  window.clearTimeout(pending.timeoutId);
  if (errorMessage) {
    pending.reject(new Error(errorMessage));
    return;
  }
  try {
    const response = JSON.parse(responseBody);
    if (response.error) {
      pending.reject(new Error(String(response.error)));
    } else {
      pending.resolve(response.result);
    }
  } catch {
    pending.reject(new Error("Stripped Plover returned invalid JSON"));
  }
};

window.handleAndroidPloverPaused = (paused) => {
  androidPloverPaused = paused;
  updatePloverStatusUI();
  updateDisplay();
};

window.handleAndroidStenoModeChanged = (enabled) => {
  androidStenoModeEnabled = enabled;
  clearPressedQwertyKeys();
  updateDisplay();
};

window.handleAndroidRawOutlineModeChanged = (enabled) => {
  androidRawOutlineMode = enabled;
  clearPressedQwertyKeys();
  updateDisplay();
};

function syncAndroidPreedit(candidateDiffPlan: CandidateDiffPlan | null) {
  if (!androidIme) return;
  const grammarSections = (candidateDiffPlan?.sections ?? [])
    .slice(0, 2)
    .filter((section) => section.end > section.start)
    .map((section) => {
      const suggestions: string[] = [];
      for (const candidate of candidateDiffPlan?.candidates.slice(1) ?? []) {
        const alternative = candidate.sections.find(
          ({ role }) => role === section.role,
        );
        if (
          alternative?.changes &&
          alternative.text !== section.text &&
          !suggestions.includes(alternative.text)
        ) {
          suggestions.push(alternative.text);
        }
      }
      return {
        start: section.start,
        end: section.end,
        suggestions: suggestions.slice(0, 5),
      };
    });
  androidIme.setPreeditText(
    renderVisibleText(state.islands, state.candidates),
    JSON.stringify(grammarSections),
  );
}

function syncAndroidKeyboardHeight(candidateArea: HTMLElement) {
  if (!androidIme) return;
  window.requestAnimationFrame(() => {
    if (
      document.body.classList.contains("stripped-plover-active") ||
      document.body.classList.contains("android-normal-typing") ||
      document.body.classList.contains("android-raw-outline")
    ) {
      if (lastRequestedAndroidKeyboardHeight !== 48) {
        lastRequestedAndroidKeyboardHeight = 48;
        androidIme.setKeyboardHeight(48);
      }
      return;
    }

    const candidatesVisible =
      getComputedStyle(candidateArea).display !== "none";
    const toolbar = document.querySelector<HTMLElement>(".ime-toolbar");
    const workbench = document.getElementById("workbench");
    const label = document.querySelector<HTMLElement>(".ime-composition-label");
    const display = document.getElementById("text-display");
    const flow = display?.querySelector<HTMLElement>(".text-display-flow");
    const inferenceError =
      document.getElementById<HTMLElement>("inference-error");
    if (!toolbar || !workbench || !display || !flow) return;

    const workbenchStyle = getComputedStyle(workbench);
    const displayStyle = getComputedStyle(display);
    const verticalPadding =
      parseFloat(workbenchStyle.paddingTop) +
      parseFloat(workbenchStyle.paddingBottom);
    const displayPadding =
      parseFloat(displayStyle.paddingTop) +
      parseFloat(displayStyle.paddingBottom);
    const labelHeight =
      label && getComputedStyle(label).display !== "none"
        ? label.offsetHeight + 4
        : 0;
    const bufferContentHeight = Math.max(32, flow.scrollHeight);
    const inferenceErrorHeight =
      inferenceError && !inferenceError.hidden
        ? inferenceError.offsetHeight + 6
        : 0;
    const candidateHeight = candidatesVisible ? candidateArea.scrollHeight : 0;
    const desiredHeight = Math.max(
      112,
      Math.ceil(
        toolbar.offsetHeight +
          verticalPadding +
          labelHeight +
          displayPadding +
          bufferContentHeight +
          inferenceErrorHeight +
          candidateHeight,
      ),
    );
    if (desiredHeight !== lastRequestedAndroidKeyboardHeight) {
      lastRequestedAndroidKeyboardHeight = desiredHeight;
      androidIme.setKeyboardHeight(desiredHeight);
    }
  });
}

window.addEventListener("resize", () => {
  const candidateArea = document.getElementById("candidate-area");
  if (candidateArea) {
    syncAndroidKeyboardHeight(candidateArea);
  }
});

window.clearPreeditFromAndroid = () => {
  abortInferenceRequest(true);
  strippedPlover.requestId += 1;
  strippedPlover.preeditIndex = null;
  if (strippedPlover.available) {
    void ploverRpc("reset_state", {}).catch((error) => {
      console.error("Failed to reset Stripped Plover preedit state:", error);
    });
  }
  buffer.reset();
  state.candidates = [];
  inferenceErrorMessage =
    androidIme && inferenceModelState === "error"
      ? androidIme.getInferenceModelError()
      : "";
  piecemealCursorIndex = null;
  isRawMode = false;
  updateDisplay();
};

window.handleAndroidKeyEvent = (
  action,
  key,
  code,
  repeat,
  shiftKey,
  ctrlKey,
  altKey,
  metaKey,
) => {
  document.dispatchEvent(
    new KeyboardEvent(action, {
      key,
      code,
      repeat,
      shiftKey,
      ctrlKey,
      altKey,
      metaKey,
      bubbles: true,
      cancelable: true,
    }),
  );
};

window.setStrippedDisplay = (options = {}) => {
  isRawMode = false;
  strippedDisplay = {
    enabled: true,
    copyAllowed: options.copyAllowed === true,
  };
  updateDisplay();
};

if (!isDictionaryManagementPage) {
  if (androidIme) {
    window.setStrippedDisplay();
    updateInferenceStatusUI();
  }
  updateDisplay();
}
