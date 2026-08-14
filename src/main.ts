import {
  type Island,
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
import { decodeV7PermittedSyllableStroke } from "./vietnameseSyllables";
import {
  buildCandidateDiffPlan,
  type CandidateDiffPlan,
  type VisibleTextSegment,
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
import { ploverProtocolErrorMessage } from "./ploverProtocol";
import {
  decodeCanonicalTwoSyllableStroke,
  decodeDictionaryModeStroke,
} from "./twoSyllableV7";
import { TelexComposer } from "./telex";

// Maps for V7 Decoding
type RetroSpaceAction = "insert" | "delete";

interface EmilyResult {
  type: "emily";
  value: string;
  leftSpace: boolean;
  rightSpace: boolean;
  explicitSpacing: boolean;
  capNext: boolean;
  retroSpace: RetroSpaceAction | null;
  repeat: number;
}

interface PloverDictionary {
  name?: string;
  identifier: string;
  path?: string;
  entries?: number;
  type: "json" | "python";
  enabled: boolean;
}

interface PloverEntry {
  dictionary?: string;
  stroke: string;
  translation: string;
}

interface PloverOutputItem {
  type: "committed" | "preedit";
  text?: string;
}

interface PloverRpcResult {
  dictionaries?: PloverDictionary[];
  solo?: boolean;
  output?: PloverOutputItem[];
  type?: "json" | "python";
  pythonCode?: string;
  data?: unknown;
  page?: number;
  entries?: PloverEntry[];
  has_more?: boolean;
  total?: number;
  translation?: string;
  stroke?: string;
  strokes?: string[];
}

interface PloverPendingRequest {
  resolve: (value: PloverRpcResult) => void;
  reject: (reason: Error) => void;
}

type LoadingControl = HTMLButtonElement | HTMLSelectElement;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// Emily symbols (subset mapping adapted from emily-symbols)
const EMILY_ATTACHMENT_METHOD = "space";
const EMILY_NO_SPACING_SYMBOLS = ["{*!}", "{*?}"];
const EMILY_SYMBOLS: Record<string, readonly string[]> = {
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

function handleEmilySymbol(stroke: string): EmilyResult | null {
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

  const output = symbol.repeat(repeat);

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

function applyRetroactiveSpace(
  action: RetroSpaceAction | null,
  repeat: number,
): boolean {
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

// --- App State ---

const buffer = new TextBuffer();
interface AppState {
  islands: Island[];
  pendingCapitalization: boolean;
  candidates: string[][];
}

const state: AppState = {
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
  isPlainTextMode?(): boolean;
  isRawOutlineMode?(): boolean;
  isStenoModeEnabled?(): boolean;
  isTelexModeEnabled?(): boolean;
  changeInputMethod(): void;
  requestInferenceSync(body: string, requestId: number): string;
  requestPlover(body: string, requestId: number): void;
  setPreeditText(text: string, grammarSectionsJson: string): void;
  commitTelexText?(expectedText: string, separator: string): void;
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
let androidTelexModeEnabled = androidIme?.isTelexModeEnabled?.() ?? false;
let androidRawOutlineMode = androidIme?.isRawOutlineMode?.() ?? false;
let androidPlainTextMode = androidIme?.isPlainTextMode?.() ?? false;
let androidPloverPaused = androidIme?.isPloverPaused?.() ?? false;
let keyboardCapsLockActive = false;
if (androidIme) {
  inferenceErrorMessage = androidIme.getInferenceModelError();
}
let androidInferenceRequestId = 1;
let inferenceRunGeneration = 0;
let lastRequestedAndroidKeyboardHeight = 0;
let lastExpandedAndroidKeyboardHeight = 160;
let androidPloverRequestId = 1;
const ANDROID_PLOVER_REQUEST_TIMEOUT_MS = 180_000;
const androidPloverPending = new Map<
  number,
  {
    resolve: (value: PloverRpcResult) => void;
    reject: (reason: Error) => void;
    timeoutId: number;
  }
>();

let piecemealCursorIndex: number | null = null;
let inferenceAbortController: AbortController | null = null;
let isKeyboardLayoutVisible = false;
const pressedQwertyKeys = new Set<string>();
const strippedPlover: {
  available: boolean;
  enabled: boolean;
  solo: boolean;
  preeditIndex: number | null;
  requestId: number;
} = {
  available: false,
  enabled: false,
  solo: false,
  preeditIndex: null,
  requestId: 0,
};
let ploverDictionaries: PloverDictionary[] = [];
let ploverSocket: WebSocket | null = null;
let ploverSocketReady: Promise<WebSocket> | null = null;
let ploverSocketReadyReject: ((reason: Error) => void) | null = null;
let ploverRpcId = 1;
const ploverPending = new Map<string, PloverPendingRequest>();
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
let ploverStatusTimer: number | null = null;
let ploverStatusCheckInFlight = false;
let androidDictionaryImportTaskId = "";
let androidDictionaryImportTimer: number | null = null;

function isDictionaryTextInputFocused(
  target: Element | null = document.activeElement,
): boolean {
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

function saveState(group?: string): void {
  undoManager.save(group);
}

function restoreState(): void {
  undoManager.undo();
}

function setPloverMessage(message: string): void {
  const messageEl = document.getElementById("plover-message");
  if (messageEl) {
    messageEl.textContent = message || "";
  }
}

function setEntryMessage(message: string): void {
  const messageEl = document.getElementById("plover-entry-message");
  if (messageEl) {
    messageEl.textContent = message || "";
  }
}

function setLookupMessage(message: string): void {
  const messageEl = document.getElementById("plover-lookup-message");
  if (messageEl) {
    messageEl.textContent = message || "";
  }
}

function setButtonLoading(
  button: LoadingControl | null,
  isLoading: boolean,
  loadingText = "",
): void {
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

function getDictionarySignature(dictionaries: PloverDictionary[]): string {
  return JSON.stringify(
    dictionaries.map((dict) => ({
      name: dict.name || "",
      identifier: dict.identifier || "",
      path: dict.path || "",
      entries: dict.entries ?? 0,
      type: dict.type,
      enabled: !!dict.enabled,
    })),
  );
}

function updatePloverDictionaries(
  nextDictionaries: PloverDictionary[],
  { force = false }: { force?: boolean } = {},
): boolean {
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

function updatePloverSoloUI(): void {
  const statusEl = document.getElementById("plover-solo-status");
  const endSoloButton = document.getElementById(
    "plover-end-solo",
  ) as HTMLButtonElement | null;
  if (statusEl) {
    statusEl.textContent = strippedPlover.solo ? "Solo" : "Normal";
  }
  if (endSoloButton) {
    endSoloButton.disabled = !strippedPlover.available || !strippedPlover.solo;
  }
}

function updatePloverStatusUI(): void {
  const statusEl = document.getElementById("plover-status");
  const dictionaryButton = document.getElementById(
    "plover-dictionary-open",
  ) as HTMLButtonElement | null;
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

async function fetchPloverStatus(): Promise<void> {
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
      const data = (await resp.json()) as { available?: boolean };
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

function clearPloverStatusTimer(): void {
  if (ploverStatusTimer) {
    clearTimeout(ploverStatusTimer);
    ploverStatusTimer = null;
  }
}

function schedulePloverStatusRetry(): void {
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

async function ensurePloverAvailability(): Promise<void> {
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

function resetPloverSocket(message: string): void {
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

function ensurePloverSocket(): Promise<WebSocket> {
  if (androidPloverBridge) {
    return Promise.reject(
      new Error("Android uses its native Stripped Plover bridge"),
    );
  }
  if (ploverSocketReady) return ploverSocketReady;
  ploverSocketReady = new Promise<WebSocket>((resolve, reject) => {
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
        const data = JSON.parse(String(event.data)) as {
          id?: unknown;
          ok?: boolean;
          result?: PloverRpcResult;
          error?: string;
          dictionaries?: PloverDictionary[];
          solo?: boolean;
        };
        if (!data.id) {
          const dictionaries = data.dictionaries || data.result?.dictionaries;
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
            pending.resolve(data.result ?? {});
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

async function ploverRpc(
  method: string,
  params: Record<string, unknown>,
): Promise<PloverRpcResult> {
  if (androidPloverBridge) {
    return requestAndroidPlover(method, params);
  }
  const socket = await ensurePloverSocket();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Stripped Plover unavailable");
  }
  const id = ploverRpcId++;
  const payload = { id, method, params };
  const promise = new Promise<PloverRpcResult>((resolve, reject) => {
    const key = JSON.stringify(id);
    socket.send(JSON.stringify(payload));
    ploverPending.set(key, { resolve, reject });
  });
  return promise;
}

function clearPloverPreedit(): void {
  if (strippedPlover.preeditIndex !== null) {
    const index = strippedPlover.preeditIndex;
    if (index >= 0 && index < buffer.getIslandCount()) {
      buffer.removeIslandAt(index);
    }
    strippedPlover.preeditIndex = null;
  }
}

function syncPloverPreeditIndex(): void {
  const islands = buffer.getIslands();
  strippedPlover.preeditIndex = null;
  for (let i = islands.length - 1; i >= 0; i--) {
    if (islands[i]?.ploverPreedit) {
      strippedPlover.preeditIndex = i;
      break;
    }
  }
}

function finalizePloverPreedit(): void {
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
  output: PloverOutputItem[],
  {
    recordHistory,
    allowInference,
    finalizePreedit,
    uppercase,
  }: {
    recordHistory: boolean;
    allowInference: boolean;
    finalizePreedit: boolean;
    uppercase: boolean;
  },
): void {
  if (!Array.isArray(output)) return;
  const committedParts: string[] = [];
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
  const committedText = applyCapsLockToText(
    ensureString(combinedCommitted),
    uppercase,
  );
  const normalizedPreedit = finalizePreedit
    ? ""
    : applyCapsLockToText(ensureString(preeditText), uppercase);
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

async function handlePloverStroke(
  stroke: string,
  { oneShot }: { oneShot: boolean },
): Promise<void> {
  if (!strippedPlover.available || androidPloverPaused) return;
  const currentRequest = ++strippedPlover.requestId;
  const uppercase = keyboardCapsLockActive;
  try {
    const result = await ploverRpc("translate", { stroke });
    if (currentRequest !== strippedPlover.requestId) return;
    applyPloverOutput(result.output ?? [], {
      recordHistory: oneShot,
      allowInference: true,
      finalizePreedit: oneShot,
      uppercase,
    });
    if (oneShot) {
      await ploverRpc("reset_state", {});
    }
  } catch (e) {
    if (currentRequest !== strippedPlover.requestId) return;
    console.log(e);
    setPloverMessage(errorMessage(e, "Stripped Plover request failed."));
  }
}

async function togglePloverMode(): Promise<void> {
  if (!strippedPlover.available || androidPloverPaused) return;
  strippedPlover.enabled = !strippedPlover.enabled;
  setPloverMessage("");
  if (!strippedPlover.enabled) {
    finalizePloverPreedit();
    try {
      await ploverRpc("reset_state", {});
    } catch (e) {
      console.log(e);
      setPloverMessage(errorMessage(e, "Failed to reset Stripped Plover."));
    }
    runInference();
  } else {
    runInference();
  }
  updatePloverStatusUI();
  updateDisplay();
}

async function refreshPloverDictionaries({
  force = false,
}: { force?: boolean } = {}): Promise<void> {
  if (!strippedPlover.available) return;
  try {
    const result = await ploverRpc("get_dictionary_state", {});
    strippedPlover.solo = !!result.solo;
    const dictionaries = result.dictionaries || [];
    updatePloverDictionaries(dictionaries, { force });
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(errorMessage(e, "Failed to load dictionaries."));
  }
}

async function createBlankJsonDictionary(
  button: HTMLButtonElement,
): Promise<void> {
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
  const editSelectEl = document.getElementById(
    "plover-entry-dict",
  ) as HTMLSelectElement | null;
  const searchSelectEl = document.getElementById(
    "plover-entry-search-dict",
  ) as HTMLSelectElement | null;
  const availableDictionaries = ploverDictionaries.filter(
    (dict) => dict.type === "json",
  );

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
      option.textContent = dict.identifier;
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
  const selectEl = document.getElementById(
    "plover-entry-dict",
  ) as HTMLSelectElement | null;
  const addButton = document.getElementById(
    "plover-entry-add",
  ) as HTMLButtonElement | null;
  const updateButton = document.getElementById(
    "plover-entry-update",
  ) as HTMLButtonElement | null;
  const removeButton = document.getElementById(
    "plover-entry-remove",
  ) as HTMLButtonElement | null;
  if (!selectEl || !addButton || !updateButton || !removeButton) return;
  const selectedId = selectEl.value || "";
  const selectedDict = selectedId
    ? ploverDictionaries.find((dict) => dict.identifier === selectedId)
    : null;
  const canEdit = selectedDict?.type === "json";
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
  } else if (selectedDict.type !== "json") {
    setEntryMessage("Python dictionaries do not expose concrete entries.");
  } else {
    setEntryMessage("");
  }
}

function getDictionaryFilename(
  dict: PloverDictionary,
  extension: string,
): string {
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

function pollAndroidDictionaryImport(
  taskId = androidDictionaryImportTaskId,
): void {
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

function downloadDictionaryFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
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

async function exportDictionary(
  dict: PloverDictionary,
  button: LoadingControl,
): Promise<void> {
  const name = dict.identifier;
  if (!name) return;
  setButtonLoading(button, true, "Exporting...");
  try {
    const result = await ploverRpc("export_dictionary", { name });
    const type = result.type ?? "json";
    if (type === "python") {
      const filename = getDictionaryFilename(dict, "py");
      downloadDictionaryFile(
        filename,
        result.pythonCode ?? "",
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
    setPloverMessage(errorMessage(e, "Failed to export dictionary."));
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function renameDictionary(
  dict: PloverDictionary,
  button: LoadingControl,
): Promise<void> {
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
    setPloverMessage(errorMessage(e, "Failed to rename dictionary."));
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function deleteDictionary(
  dict: PloverDictionary,
  button: LoadingControl,
): Promise<void> {
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
    setPloverMessage(errorMessage(e, "Failed to delete dictionary."));
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function setDictionaryEnabled(
  dict: PloverDictionary,
  enabled: boolean,
  button: LoadingControl,
): Promise<void> {
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
    setPloverMessage(errorMessage(e, "Failed to update dictionary state."));
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function prioritizeDictionaryOrder(
  identifiers: string[],
  button: LoadingControl,
): Promise<void> {
  if (identifiers.length === 0) return;
  setButtonLoading(button, true, "Moving...");
  try {
    const result = await ploverRpc("prioritize_dictionaries", { identifiers });
    updatePloverDictionaries(result.dictionaries || [], { force: true });
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(errorMessage(e, "Failed to reorder dictionaries."));
  } finally {
    setButtonLoading(button, false, "");
  }
}

function getMovedDictionaryOrder(
  index: number,
  direction: -1 | 1,
): string[] | null {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= ploverDictionaries.length) return null;
  const identifiers = ploverDictionaries.map((dict) => dict.identifier);
  const [identifier] = identifiers.splice(index, 1);
  identifiers.splice(nextIndex, 0, identifier);
  return identifiers;
}

async function soloDictionary(
  dict: PloverDictionary,
  button: LoadingControl,
): Promise<void> {
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
    setPloverMessage(errorMessage(e, "Failed to solo dictionary."));
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function endSoloDictionaries(button: LoadingControl): Promise<void> {
  setButtonLoading(button, true, "Ending...");
  try {
    const result = await ploverRpc("end_solo_dictionaries", {});
    strippedPlover.solo = !!result.solo;
    updatePloverDictionaries(result.dictionaries || [], { force: true });
    setPloverMessage("");
  } catch (e) {
    console.log(e);
    setPloverMessage(errorMessage(e, "Failed to end solo mode."));
  } finally {
    setButtonLoading(button, false, "");
  }
}

function createDictionaryActionOption(
  value: string,
  label: string,
  disabled = false,
): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.disabled = disabled;
  return option;
}

type DictionaryAction =
  | "enable"
  | "disable"
  | "up"
  | "down"
  | "solo"
  | "export"
  | "rename"
  | "delete";

async function runDictionaryAction(
  dict: PloverDictionary,
  index: number,
  action: DictionaryAction,
  control: LoadingControl,
): Promise<void> {
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

function openDictionaryEntries(dict: PloverDictionary): void {
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
    entriesButton.textContent =
      dict.type === "json" ? "View / edit entries" : "Code-backed dictionary";
    entriesButton.disabled = dict.type !== "json";
    if (dict.type === "json") {
      entriesButton.addEventListener("click", () =>
        openDictionaryEntries(dict),
      );
    }
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
    actionSelect.appendChild(createDictionaryActionOption("rename", "Rename"));
    actionSelect.appendChild(createDictionaryActionOption("delete", "Delete"));
    actionSelect.addEventListener("change", () => {
      const action = actionSelect.value as DictionaryAction | "";
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

function fillEntryEditor(entry: PloverEntry): void {
  const dictSelect = document.getElementById(
    "plover-entry-dict",
  ) as HTMLSelectElement | null;
  const strokeInput = document.getElementById(
    "plover-entry-stroke",
  ) as HTMLInputElement | null;
  const translationInput = document.getElementById(
    "plover-entry-translation",
  ) as HTMLInputElement | null;
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

function renderEntryRows(container: HTMLElement, entries: PloverEntry[]): void {
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

function updateEntryPagination(result: PloverRpcResult): void {
  const prevButton = document.getElementById(
    "plover-entry-prev",
  ) as HTMLButtonElement | null;
  const nextButton = document.getElementById(
    "plover-entry-next",
  ) as HTMLButtonElement | null;
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

interface EntrySearchParams extends Record<string, unknown> {
  page: number;
  page_size: number;
  sort: string;
  dictionary?: string;
  stroke?: string;
  output?: string;
  match?: string;
}

function getEntrySearchParams(page: number): {
  params: EntrySearchParams;
  hasSearchQuery: boolean;
} {
  const dictSelect = document.getElementById(
    "plover-entry-search-dict",
  ) as HTMLSelectElement | null;
  const strokeInput = document.getElementById(
    "plover-entry-search-stroke",
  ) as HTMLInputElement | null;
  const outputInput = document.getElementById(
    "plover-entry-search-output",
  ) as HTMLInputElement | null;
  const matchSelect = document.getElementById(
    "plover-entry-search-match",
  ) as HTMLSelectElement | null;
  const sortSelect = document.getElementById(
    "plover-entry-sort",
  ) as HTMLSelectElement | null;
  const dictionary = (dictSelect?.value || "").trim();
  const stroke = (strokeInput?.value || "").trim();
  const output = (outputInput?.value || "").trim();
  const params: EntrySearchParams = {
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

async function runEntrySearch({
  page = 1,
  button = null,
}: { page?: number; button?: LoadingControl | null } = {}): Promise<void> {
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
    renderEntryRows(resultsEl, result.entries ?? []);
    updateEntryPagination(result);
    setEntryMessage("");
  } catch (e) {
    console.log(e);
    setEntryMessage(errorMessage(e, "Entry search failed."));
  } finally {
    if (button) {
      setButtonLoading(button, false, "");
    }
  }
}

function renderLookupRows(entries: PloverEntry[]): void {
  const resultsEl = document.getElementById("plover-lookup-results");
  if (!resultsEl) return;
  renderEntryRows(resultsEl, entries);
}

async function runStrokeLookup(button: LoadingControl): Promise<void> {
  if (!strippedPlover.available) {
    setLookupMessage("Stripped Plover is unavailable.");
    return;
  }
  const strokeInput = document.getElementById(
    "plover-lookup-stroke",
  ) as HTMLInputElement | null;
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
    setLookupMessage(errorMessage(e, "Stroke lookup failed."));
  } finally {
    setButtonLoading(button, false, "");
  }
}

async function runReverseLookup(button: LoadingControl): Promise<void> {
  if (!strippedPlover.available) {
    setLookupMessage("Stripped Plover is unavailable.");
    return;
  }
  const translationInput = document.getElementById(
    "plover-lookup-translation",
  ) as HTMLInputElement | null;
  const translation = (translationInput?.value || "").trim();
  if (!translation) {
    setLookupMessage("Provide a translation to look up.");
    return;
  }
  setButtonLoading(button, true, "Looking...");
  try {
    const result = await ploverRpc("reverse_lookup", { translation });
    const entries: PloverEntry[] = (result.strokes ?? []).map((stroke) => ({
      stroke,
      translation: result.translation || translation,
      dictionary: "active dictionaries",
    }));
    renderLookupRows(entries);
    setLookupMessage(entries.length > 0 ? "" : "No strokes found.");
  } catch (e) {
    console.log(e);
    setLookupMessage(errorMessage(e, "Reverse lookup failed."));
  } finally {
    setButtonLoading(button, false, "");
  }
}

// --- Logic ---

function appendText(text: string): void {
  if (keyboardCapsLockActive && text.length > 0) {
    text = applyCapsLockToText(text, true);
    state.pendingCapitalization = false;
  } else if (state.pendingCapitalization && text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    state.pendingCapitalization = false;
  }
  // Append a new Vietnamese (generic text) island
  buffer.appendIsland(createIsland("vietnamese", text));
}

function applyCapsLockToText(
  text: string,
  active = keyboardCapsLockActive,
): string {
  return active ? text.toLocaleUpperCase("vi") : text;
}

function abortInferenceRequest(clearController: boolean): void {
  if (inferenceAbortController) {
    inferenceAbortController.abort();
    if (clearController) {
      inferenceAbortController = null;
    }
  }
}

function isStaleInference(controller: AbortController | null): boolean {
  return controller !== null && controller !== inferenceAbortController;
}

async function handleChord(stroke: string): Promise<void> {
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

  if (strippedPlover.enabled && !androidPlainTextMode) {
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
    const textArea = document.getElementById(
      "text-input",
    ) as HTMLTextAreaElement | null;
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
      const appendedSyllable = decodeV7PermittedSyllableStroke(
        firstCandidateAppendStroke,
      );
      if (appendedSyllable !== null) {
        saveState();
        piecemealCursorIndex = null;
        appendText(appendedSyllable);
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
      const decodedReplacement = decodeV7PermittedSyllableStroke(stroke);
      const replacement =
        decodedReplacement === null
          ? null
          : applyCapsLockToText(decodedReplacement);
      if (replacement !== null) {
        const targets = findPiecemealSyllableTargets(state.islands);
        const target = targets[piecemealCursorIndex];
        if (target) {
          saveState();
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

  // Dictionary classification owns both starred aliases and the starless corner.
  const dictionaryDecode = decodeDictionaryModeStroke(stroke);
  const ordinaryDecode = dictionaryDecode
    ? null
    : decodeCanonicalTwoSyllableStroke(stroke);
  const twoSyllableDecode = dictionaryDecode ?? ordinaryDecode;
  if (twoSyllableDecode) {
    window.dispatchEvent(
      new CustomEvent("v7-editor-interpretation", {
        detail: {
          stroke,
          interpretation: dictionaryDecode
            ? "dictionary-v7"
            : "compositional-v7",
          sourceV7Stroke: twoSyllableDecode.canonicalStroke,
          sourceV7Code: twoSyllableDecode.v7Code,
        },
      }),
    );
    piecemealCursorIndex = null;
    saveState();
    const uppercase = keyboardCapsLockActive;
    const capitalize = !uppercase && state.pendingCapitalization;
    state.pendingCapitalization = false;
    buffer.appendIsland(
      createIsland("vietnamese", twoSyllableDecode.v7Code, true, {
        capitalize,
        uppercase,
        v7Mode: dictionaryDecode ? "dictionary" : "compositional",
      }),
    );
    runInference();
    return;
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
      createIsland(
        emilyResult.type,
        applyCapsLockToText(emilyResult.value),
        false,
        {
          leftSpace: emilyResult.leftSpace,
          rightSpace: emilyResult.rightSpace,
          explicitSpacing: emilyResult.explicitSpacing,
        },
      ),
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
    const syllableText = decodeV7PermittedSyllableStroke(
      selection.syllableStroke,
    );
    if (syllableText !== null) {
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

  const text = decodeV7PermittedSyllableStroke(stroke);
  if (text !== null) {
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
    const appendedSyllable = decodeV7PermittedSyllableStroke(
      firstCandidateAppendStroke,
    );
    if (appendedSyllable !== null) {
      saveState();
      piecemealCursorIndex = null;
      appendText(appendedSyllable);
      runInference();
      return;
    }
  }

  if (selection && selection.syllableStroke === null) {
    selectCandidate(selection.candidateIndex);
    return;
  }

  if (strippedPlover.available && !androidPlainTextMode) {
    await handlePloverStroke(stroke, { oneShot: true });
    return;
  }

  console.log("Ignored stroke:", stroke);
}

async function runInference() {
  // Optimization: If no V7 islands, skip inference
  const hasV7 = state.islands.some((i) => i.isV7);
  if (!hasV7) {
    inferenceRunGeneration += 1;
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
  const runGeneration = ++inferenceRunGeneration;
  const controller = hasAbortController ? new AbortController() : null;
  inferenceAbortController = controller;
  // Candidates from the previous buffer are no longer valid. Avoid flashing
  // raw V7 while the synchronous Android bridge produces their replacements.
  state.candidates = [];
  buffer.setIslands(
    state.islands.map((island) => {
      if (island.v7Mode !== "dictionary") return island;
      const { dictionaryBucketSize: _stale, ...pendingIsland } = island;
      return pendingIsland;
    }),
  );
  if (!shouldDeferAndroidInferenceRender()) {
    updateDisplay();
  }

  try {
    // Send the versioned protocol; mode is semantic data, not part of V7 code.
    const serverIslands = convertIslandsForInference(state.islands);

    const requestBody = JSON.stringify({ version: 2, islands: serverIslands });
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
    const bucketSizes = getDictionaryBucketSizes(data);
    let dictionaryIndex = 0;
    buffer.setIslands(
      state.islands.map((island) =>
        island.v7Mode === "dictionary"
          ? {
              ...island,
              dictionaryBucketSize: bucketSizes[dictionaryIndex++],
            }
          : island,
      ),
    );
    inferenceErrorMessage = "";
    updateDisplay();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
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

function shouldDeferAndroidInferenceRender(): boolean {
  return !!androidIme && inferenceModelState === "ready";
}

function hasOsPassthroughModifier(event: KeyboardEvent): boolean {
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

function getDictionaryBucketSizes(data: unknown): number[] {
  if (!data || typeof data !== "object") return [];
  const sizes = (data as { dictionaryBucketSizes?: unknown })
    .dictionaryBucketSizes;
  if (sizes === undefined) return [];
  if (
    !Array.isArray(sizes) ||
    !sizes.every((size) => Number.isSafeInteger(size) && size >= 0)
  ) {
    throw new Error("Inference response has invalid dictionary bucket sizes");
  }
  return sizes as number[];
}

type SelectCandidateOptions = {
  saveHistory: boolean;
  refreshDisplay: boolean;
};

function selectCandidate(
  index: number,
  options: SelectCandidateOptions = { saveHistory: true, refreshDisplay: true },
): boolean {
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

function updateInputPadding(
  display: HTMLElement,
  textArea: HTMLTextAreaElement,
  candidateArea: HTMLElement,
): void {
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

function scrollToBottom(element: HTMLElement): void {
  element.scrollTop = element.scrollHeight;
  requestAnimationFrame(() => {
    element.scrollTop = element.scrollHeight;
  });
}

function formatKeyboardKeyLabel(key: string): string {
  if (key === " ") return "Spacebar";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function renderKeyboardLayout(): void {
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

function updateKeyboardLayout(): void {
  const layout = document.getElementById("keyboard-layout");
  if (!layout) return;

  layout.classList.toggle("visible", isKeyboardLayoutVisible);
  layout.setAttribute(
    "aria-hidden",
    isKeyboardLayoutVisible ? "false" : "true",
  );
  for (const keyEl of layout.querySelectorAll<HTMLElement>(".qwerty-key")) {
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

function renderVisibleSegmentFragment(
  segment: VisibleTextSegment,
): DocumentFragment {
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

function setKeyboardLayoutVisible(visible: boolean): void {
  isKeyboardLayoutVisible = visible;
  updateKeyboardLayout();
}

function toggleKeyboardLayout(): void {
  setKeyboardLayoutVisible(!isKeyboardLayoutVisible);
}

function updateInferenceErrorUI(): void {
  const inferenceError = document.getElementById("inference-error");
  if (!inferenceError) return;
  inferenceError.hidden = inferenceErrorMessage === "";
  inferenceError.textContent = inferenceErrorMessage
    ? isTrainerEmbedded
      ? `Không lấy được các cách viết: ${inferenceErrorMessage}`
      : `Inference error: ${inferenceErrorMessage}`
    : "";
}

function setupImeControls(): void {
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

function updateInferenceStatusUI(): void {
  const status = document.getElementById("inference-status");
  if (!status || !androidIme) return;
  updateInferenceErrorUI();
  const labels: Record<string, string> = {
    missing: "Model missing",
    not_loaded: "Model not loaded",
    loading: "Loading model… · raw buffer",
    ready: "Model ready",
    error: "Model error",
  };
  status.textContent =
    labels[inferenceModelState] ?? `Model ${inferenceModelState}`;
  status.className = `ime-mode-detail ${inferenceModelState}`;
  status.title = "";
}

function trackQwertyKey(event: KeyboardEvent, isPressed: boolean): void {
  const key = normalizeQwertyDisplayKey(event.key, event.code || "");
  if (!key) return;
  if (isPressed) {
    pressedQwertyKeys.add(key);
  } else {
    pressedQwertyKeys.delete(key);
  }
  updateKeyboardLayout();
}

function resetHardwareKeyboardState(): void {
  keyboardStrokeTracker.reset();
  if (pressedQwertyKeys.size !== 0) {
    pressedQwertyKeys.clear();
    updateKeyboardLayout();
  }
}

function updateDisplay(): void {
  if (androidIme) {
    updateInferenceStatusUI();
  }
  const display = document.getElementById("text-display") as HTMLElement | null;
  const textArea = document.getElementById(
    "text-input",
  ) as HTMLTextAreaElement | null;
  const candArea = document.getElementById(
    "candidate-area",
  ) as HTMLElement | null;
  if (!display || !textArea || !candArea) return;

  const text = renderVisibleText(state.islands, state.candidates);
  const candidateDiffPlan =
    state.candidates.length > 0
      ? buildCandidateDiffPlan(state.islands, state.candidates)
      : null;

  document.body.classList.toggle("stripped-display", strippedDisplay.enabled);
  document.body.classList.toggle(
    "android-normal-typing",
    strippedDisplay.enabled &&
      (!androidStenoModeEnabled || androidPlainTextMode) &&
      !androidTelexModeEnabled &&
      !androidRawOutlineMode,
  );
  document.body.classList.toggle(
    "android-telex",
    strippedDisplay.enabled &&
      androidTelexModeEnabled &&
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
      : androidTelexModeEnabled
        ? "Telex"
        : androidStenoModeEnabled && !androidPlainTextMode
          ? "Compose"
          : "Normal typing";
  }
  document.body.classList.toggle(
    "stripped-plover-active",
    strippedDisplay.enabled &&
      androidStenoModeEnabled &&
      !androidRawOutlineMode &&
      !androidPlainTextMode &&
      strippedPlover.enabled,
  );
  updateInferenceErrorUI();
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
    let textFlow: HTMLElement = display;
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
        sup.textContent = String(i + 1);
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
        v7Modes: state.islands
          .filter((island) => island.isV7)
          .map((island) => island.v7Mode ?? "compositional"),
      },
    }),
  );
}

// --- Input Handling ---

const keyboardStrokeTracker = new KeyboardStrokeTracker();
const telexComposer = new TelexComposer();

document.addEventListener("keydown", (e) => {
  if (!androidIme) {
    keyboardCapsLockActive = e.getModifierState("CapsLock");
  }
  if (androidIme && androidTelexModeEnabled) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "Backspace") {
      androidIme.setPreeditText(telexComposer.backspace(), "[]");
      e.preventDefault();
      return;
    }
    if (Array.from(e.key).length === 1 && /[\p{L}\[\]]/u.test(e.key)) {
      androidIme.setPreeditText(telexComposer.push(e.key), "[]");
      e.preventDefault();
      return;
    }
    if (
      Array.from(e.key).length === 1 ||
      e.key === "Enter" ||
      e.key === "Tab"
    ) {
      const separator =
        e.key === "Enter" ? "\n" : e.key === "Tab" ? "\t" : e.key;
      const expectedText = telexComposer.commit();
      androidIme.commitTelexText?.(expectedText, separator);
      e.preventDefault();
      return;
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    resetHardwareKeyboardState();
    if (!e.repeat) {
      toggleKeyboardLayout();
    }
    e.preventDefault();
    return;
  }

  // Global Shortcuts
  if (e.ctrlKey && e.key === "c") {
    resetHardwareKeyboardState();
    // Copy entire buffer if nothing selected
    if (
      (!strippedDisplay.enabled || strippedDisplay.copyAllowed) &&
      !window.getSelection()?.toString()
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
    resetHardwareKeyboardState();
    return;
  }

  trackQwertyKey(e, true);

  if (isDictionaryTextInputFocused(e.target as Element | null)) {
    return; // Allow normal typing in dictionary text boxes
  }

  if (isRawMode) {
    if (e.key === "Escape") {
      // Exit Raw Mode
      const textArea = document.getElementById(
        "text-input",
      ) as HTMLTextAreaElement | null;
      if (!textArea) return;
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

  const ploverActive = strippedPlover.enabled && !androidPlainTextMode;

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
  if (!androidIme) {
    keyboardCapsLockActive = e.getModifierState("CapsLock");
  }
  if (androidIme && androidTelexModeEnabled) {
    e.preventDefault();
    return;
  }
  if (hasOsPassthroughModifier(e)) {
    resetHardwareKeyboardState();
    return;
  }

  trackQwertyKey(e, false);

  if (isRawMode) return; // Don't process steno in raw mode

  if (isDictionaryTextInputFocused(e.target as Element | null)) {
    return;
  }

  const strokeStr = keyboardStrokeTracker.keyUp(e.key);
  if (strokeStr) {
    handleChord(strokeStr).catch((err) => {
      console.error("Stroke handling failed", err);
    });
  }
});

window.addEventListener("blur", resetHardwareKeyboardState);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    resetHardwareKeyboardState();
  }
});

function setupPloverControls(): void {
  const dictionaryOpenButton = document.getElementById(
    "plover-dictionary-open",
  ) as HTMLButtonElement | null;
  const dictionaryDialog = document.getElementById(
    "plover-dictionary-dialog",
  ) as HTMLDialogElement | null;
  const dictionaryCloseButton = document.getElementById(
    "plover-dictionary-close",
  ) as HTMLButtonElement | null;
  const refreshButton = document.getElementById(
    "plover-refresh",
  ) as HTMLButtonElement | null;
  const endSoloButton = document.getElementById(
    "plover-end-solo",
  ) as HTMLButtonElement | null;
  const createDictionaryButton = document.getElementById(
    "plover-new-dictionary-create",
  ) as HTMLButtonElement | null;
  const uploadButton = document.getElementById(
    "plover-dict-upload",
  ) as HTMLButtonElement | null;
  const dictionaryFileInput = document.getElementById(
    "plover-dict-file",
  ) as HTMLInputElement | null;
  const dictionaryTypeSelect = document.getElementById(
    "plover-dict-type",
  ) as HTMLSelectElement | null;
  const entrySearchButton = document.getElementById(
    "plover-entry-search",
  ) as HTMLButtonElement | null;
  const entryPrevButton = document.getElementById(
    "plover-entry-prev",
  ) as HTMLButtonElement | null;
  const entryNextButton = document.getElementById(
    "plover-entry-next",
  ) as HTMLButtonElement | null;
  const lookupStrokeButton = document.getElementById(
    "plover-lookup-stroke-run",
  ) as HTMLButtonElement | null;
  const lookupTranslationButton = document.getElementById(
    "plover-lookup-translation-run",
  ) as HTMLButtonElement | null;
  const addButton = document.getElementById(
    "plover-entry-add",
  ) as HTMLButtonElement | null;
  const updateButton = document.getElementById(
    "plover-entry-update",
  ) as HTMLButtonElement | null;
  const removeButton = document.getElementById(
    "plover-entry-remove",
  ) as HTMLButtonElement | null;
  const dictSelect = document.getElementById(
    "plover-entry-dict",
  ) as HTMLSelectElement | null;

  for (const tab of document.querySelectorAll<HTMLElement>(".plover-tab")) {
    tab.addEventListener("click", () => {
      const panelId = tab.dataset.panel;
      if (!panelId) return;
      for (const candidate of document.querySelectorAll<HTMLElement>(
        ".plover-tab",
      )) {
        candidate.classList.toggle("active", candidate === tab);
      }
      for (const panel of document.querySelectorAll<HTMLElement>(
        ".plover-panel",
      )) {
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
      const nameInput = document.getElementById(
        "plover-dict-name",
      ) as HTMLInputElement | null;
      const mergeToggle = document.getElementById(
        "plover-dict-merge",
      ) as HTMLInputElement | null;
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
        setPloverMessage(errorMessage(e, "Failed to upload dictionary."));
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

  const entryHandler = async (
    action: "add" | "update" | "remove",
  ): Promise<void> => {
    if (!strippedPlover.available) {
      setEntryMessage("Stripped Plover is unavailable.");
      return;
    }
    const dictSelect = document.getElementById(
      "plover-entry-dict",
    ) as HTMLSelectElement | null;
    const strokeInput = document.getElementById(
      "plover-entry-stroke",
    ) as HTMLInputElement | null;
    const translationInput = document.getElementById(
      "plover-entry-translation",
    ) as HTMLInputElement | null;
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
    if (selectedDict?.type !== "json") {
      setEntryMessage("Python dictionaries do not expose concrete entries.");
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
        const result = await ploverRpc("add_entry_safely", {
          ...params,
          translation,
        });
        if (
          result &&
          typeof result === "object" &&
          "conflict" in result &&
          result.conflict === true
        ) {
          const existing =
            "existing_translation" in result &&
            typeof result.existing_translation === "string"
              ? ` Existing translation: ${result.existing_translation}`
              : "";
          setEntryMessage(`Entry already exists.${existing}`);
          return;
        }
      } else if (action === "update") {
        if (!translation) {
          setEntryMessage("Provide a translation to update an entry.");
          return;
        }
        const lookup = await ploverRpc("search_entries", {
          dictionary: name,
          stroke,
          match: "exact",
          page: 1,
          page_size: 1,
          sort: "alphabetic",
        });
        const expectedTranslation =
          typeof lookup.entries?.[0]?.translation === "string"
            ? lookup.entries[0].translation
            : null;
        if (expectedTranslation === null) {
          setEntryMessage(`Entry not found: ${stroke}`);
          return;
        }
        const result = await ploverRpc("replace_entry", {
          ...params,
          translation,
          expected_translation: expectedTranslation,
        });
        if (
          result &&
          typeof result === "object" &&
          "conflict" in result &&
          result.conflict === true
        ) {
          setEntryMessage(
            "Entry changed before it could be replaced. Refresh and try again.",
          );
          return;
        }
      } else if (action === "remove") {
        await ploverRpc("remove_entry", params);
      }
      setEntryMessage("");
      await refreshPloverDictionaries();
      await runEntrySearch({ page: ploverEntrySearchPage });
    } catch (e) {
      console.log(e);
      setEntryMessage(errorMessage(e, "Entry update failed."));
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
    resetHardwareKeyboardStateFromAndroid?: () => void;
    handleAndroidInferenceState?: (state: string) => void;
    handleAndroidInferenceWarmupError?: (errorMessage: string) => void;
    handleAndroidPloverResponse?: (
      requestId: number,
      responseBody: string,
      errorMessage: string,
    ) => void;
    handleAndroidPloverPaused?: (paused: boolean) => void;
    handleAndroidEditorModeChanged?: (
      rawOutline: boolean,
      plainText: boolean,
    ) => void;
    handleAndroidStenoModeChanged?: (enabled: boolean, telex: boolean) => void;
    handleAndroidKeyEvent?: (
      action: "keydown" | "keyup",
      key: string,
      code: string,
      repeat: boolean,
      shiftKey: boolean,
      ctrlKey: boolean,
      altKey: boolean,
      metaKey: boolean,
      capsLockActive: boolean,
    ) => void;
    setStrippedDisplay: (options?: { copyAllowed?: boolean }) => void;
  }
}

function requestAndroidInference(
  body: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!androidIme) {
    return Promise.reject(new Error("Android IME bridge is unavailable"));
  }
  if (signal?.aborted) {
    return Promise.reject(
      new DOMException("Inference request was aborted", "AbortError"),
    );
  }

  try {
    const requestId = androidInferenceRequestId++;
    const response = JSON.parse(
      androidIme.requestInferenceSync(body, requestId),
    );
    if (response.errorMessage) {
      return Promise.reject(new Error(String(response.errorMessage)));
    }
    const statusCode = Number(response.statusCode ?? 0);
    if (statusCode < 200 || statusCode >= 300) {
      return Promise.reject(
        new Error(
          `Local inference returned status ${statusCode}${
            response.responseBody ? `: ${response.responseBody}` : ""
          }`,
        ),
      );
    }
    return Promise.resolve(JSON.parse(String(response.responseBody ?? "")));
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

function requestAndroidPlover(
  method: string,
  params: unknown,
): Promise<PloverRpcResult> {
  return new Promise<PloverRpcResult>((resolve, reject) => {
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
      pending.reject(new Error(ploverProtocolErrorMessage(response.error)));
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

window.handleAndroidStenoModeChanged = (enabled, telex) => {
  androidStenoModeEnabled = enabled;
  androidTelexModeEnabled = telex;
  telexComposer.clear();
  resetHardwareKeyboardState();
  updateDisplay();
};

window.handleAndroidEditorModeChanged = (rawOutline, plainText) => {
  androidRawOutlineMode = rawOutline;
  androidPlainTextMode = plainText;
  resetHardwareKeyboardState();
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
  const compact =
    document.body.classList.contains("stripped-plover-active") ||
    document.body.classList.contains("android-normal-typing") ||
    document.body.classList.contains("android-telex") ||
    document.body.classList.contains("android-raw-outline");
  if (compact) {
    if (lastRequestedAndroidKeyboardHeight !== 48) {
      lastRequestedAndroidKeyboardHeight = 48;
      androidIme.setKeyboardHeight(48);
    }
    return;
  }

  // Restore the last measured full surface before the browser paints the mode
  // transition. Measuring from a 48 dp compact viewport first makes the full
  // workbench flash through a squeezed intermediate layout.
  if (lastRequestedAndroidKeyboardHeight === 48) {
    lastRequestedAndroidKeyboardHeight = lastExpandedAndroidKeyboardHeight;
    androidIme.setKeyboardHeight(lastExpandedAndroidKeyboardHeight);
  }

  window.requestAnimationFrame(() => {
    if (
      document.body.classList.contains("stripped-plover-active") ||
      document.body.classList.contains("android-normal-typing") ||
      document.body.classList.contains("android-raw-outline")
    ) {
      return;
    }

    const candidatesVisible =
      getComputedStyle(candidateArea).display !== "none";
    const toolbar = document.querySelector<HTMLElement>(".ime-toolbar");
    const workbench = document.getElementById("workbench");
    const label = document.querySelector<HTMLElement>(".ime-composition-label");
    const display = document.getElementById("text-display");
    const flow = display?.querySelector<HTMLElement>(".text-display-flow");
    const inferenceError = document.getElementById(
      "inference-error",
    ) as HTMLElement | null;
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
    lastExpandedAndroidKeyboardHeight = desiredHeight;
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
  telexComposer.clear();
  resetHardwareKeyboardState();
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

window.resetHardwareKeyboardStateFromAndroid = resetHardwareKeyboardState;

window.handleAndroidKeyEvent = (
  action,
  key,
  code,
  repeat,
  shiftKey,
  ctrlKey,
  altKey,
  metaKey,
  capsLockActive,
) => {
  keyboardCapsLockActive = capsLockActive;
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
