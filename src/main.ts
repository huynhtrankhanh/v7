import { TextBuffer, convertIslandsForInference, createIsland, ensureString } from "./textBuffer";
import { createUndoManager } from "./undoManager";
import { getCandidateSelectionMatch } from "./candidateSelection";
import { KeyboardStrokeTracker, mapKeyUnique, renderVisibleText, selectCandidateIslands } from "./webCore";

// --- Mappings & Constants ---

const stenographyMap = {
    "PW": "b", "K": "c", "KH": "ch", "KWR": "d", "TK": "đ", "TP": "ph",
    "TKPW": "g", "H": "h", "KWH": "gi", "KHR": "kh", "HR": "l", "PH": "m",
    "TPH": "n", "TPR": "nh", "TPW": "ng/ngh", "P": "p", "R": "r", "KP": "s",
    "T": "t", "TH": "th", "TR": "tr", "W": "v", "WR": "x",
};

const vowelMap = {
    "OEU": "iê/ia", "AEU": "ua/uô", "AOE": "ưa/ươ", "AOU": "ư", "OU": "ơ",
    "OE": "ô", "O": "o", "AU": "ê", "E": "e", "EU": "i", "A": "a",
    "AE": "ă", "AO": "â", "U": "u", "AOEU": "y",
};

const finalMap = {
    "FP": "j", "F": "w", "P": "m", "R": "n", "FR": "ng", "RP": "nh"
};

const toneMap = {
    "L": "sắc", "G": "huyền", "B": "hỏi", "LG": "ngã", "BG": "nặng",
    "BL": "ách", "BLG": "ạch"
};

const toneAccents = {
    "a": { "": "a", "sắc": "á", "huyền": "à", "hỏi": "ả", "ngã": "ã", "nặng": "ạ" },
    "ă": { "": "ă", "sắc": "ắ", "huyền": "ằ", "hỏi": "ẳ", "ngã": "ẵ", "nặng": "ặ" },
    "â": { "": "â", "sắc": "ấ", "huyền": "ầ", "hỏi": "ẩ", "ngã": "ẫ", "nặng": "ậ" },
    "e": { "": "e", "sắc": "é", "huyền": "è", "hỏi": "ẻ", "ngã": "ẽ", "nặng": "ẹ" },
    "ê": { "": "ê", "sắc": "ế", "huyền": "ề", "hỏi": "ể", "ngã": "ễ", "nặng": "ệ" },
    "i": { "": "i", "sắc": "í", "huyền": "ì", "hỏi": "ỉ", "ngã": "ĩ", "nặng": "ị" },
    "o": { "": "o", "sắc": "ó", "huyền": "ò", "hỏi": "ỏ", "ngã": "õ", "nặng": "ọ" },
    "ô": { "": "ô", "sắc": "ố", "huyền": "ồ", "hỏi": "ổ", "ngã": "ỗ", "nặng": "ộ" },
    "ơ": { "": "ơ", "sắc": "ớ", "huyền": "ờ", "hỏi": "ở", "ngã": "ỡ", "nặng": "ợ" },
    "u": { "": "u", "sắc": "ú", "huyền": "ù", "hỏi": "ủ", "ngã": "ũ", "nặng": "ụ" },
    "ư": { "": "ư", "sắc": "ứ", "huyền": "ừ", "hỏi": "ử", "ngã": "ữ", "nặng": "ự" },
    "y": { "": "y", "sắc": "ý", "huyền": "ỳ", "hỏi": "ỷ", "ngã": "ỹ", "nặng": "ỵ" },
};

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
    1: "a", 2: "o", 3: "i", 0: "e" // 0 can be e or u
};

// Emily symbols (subset mapping adapted from emily-symbols)
const EMILY_ATTACHMENT_METHOD = "space";
const EMILY_NO_SPACING_SYMBOLS = ["{*!}", "{*?}"];
const EMILY_SYMBOLS = {
    // System / navigation
    "FG": ["{#Tab}", "{#Backspace}", "{#Delete}", "{#Escape}"],
    "RPBG": ["{#Up}", "{#Left}", "{#Right}", "{#Down}"],
    "FRPBG": ["{#Page_Up}", "{#Home}", "{#End}", "{#Page_Down}"],
    "FRBG": ["{#AudioPlay}", "{#AudioPrev}", "{#AudioNext}", "{#AudioStop}"],
    "FRB": ["{#AudioMute}", "{#AudioLowerVolume}", "{#AudioRaiseVolume}", "{#Eject}"],
    "": ["", "{*!}", "{*?}", "{#Space}"],
    "FL": ["{*-|}", "{*<}", "{<}", "{*>}"],
    // Symbols
    "FR": ["!", "¬", "↦", "¡"],
    "FP": ["\"", "“", "”", "„"],
    "FRLG": ["#", "©", "®", "™"],
    "RPBL": ["$", "¥", "€", "£"],
    "FRPB": ["%", "‰", "‱", "φ"],
    "FBG": ["&", "∩", "∧", "∈"],
    "F": ["'", "‘", "’", "‚"],
    "FPL": ["(", "[", "<", "{"],
    "RBG": [")", "]", ">", "}"],
    "L": ["*", "∏", "§", "×"],
    "G": ["+", "∑", "¶", "±"],
    "B": [",", "∪", "∨", "∉"],
    "PL": ["-", "−", "–", "—"],
    "R": [".", "•", "·", "…"],
    "RP": ["/", "⇒", "⇔", "÷"],
    "LG": [":", "∋", "∵", "∴"],
    "RB": [";", "∀", "∃", "∄"],
    "PBLG": ["=", "≡", "≈", "≠"],
    "FPB": ["?", "¿", "∝", "‽"],
    "FRPBLG": ["@", "⊕", "⊗", "∅"],
    "FB": ["\\", "Δ", "√", "∞"],
    "RPG": ["^", "«", "»", "°"],
    "BG": ["_", "≤", "≥", "µ"],
    "P": ["`", "⊂", "⊃", "π"],
    "PB": ["|", "⊤", "⊥", "¦"],
    "FPBG": ["~", "⊆", "⊇", "˜"],
    "FPBL": ["↑", "←", "→", "↓"]
};
const PUNCTUATION_MAP: Record<string, string> = {
    "TP-PL": ".",
    "KW-BG": ",",
    "KW-PL": "?",
    "TP-BG": "!"
};

function handleEmilySymbol(stroke) {
    // stroke pattern: starter SKWH + attachments (A/O), capitalization (*), variants (E/U), pattern (FRPBLG)
    const match = stroke.match(/^([#]?SKWH)([AO]*)([*-]?)([EU]*)([FRPBLG]*)([TS]*)$/);
    if (!match) return null;
    const [, starter, attachments, capKey, variantKeys, pattern, repeatKeys] = match;

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
    const spaceBefore = usesSpaceAttachment ? attachments.includes("A") : !attachments.includes("A");
    const spaceAfter = usesSpaceAttachment ? attachments.includes("O") : !attachments.includes("O");

    let output = symbol.repeat(repeat);

    const capNext = capKey === "*";
    const shouldApplySpacing = !EMILY_NO_SPACING_SYMBOLS.includes(symbol);

    // leftSpace/rightSpace tags for spacing engine
    return {
        type: 'emily',
        value: output,
        leftSpace: shouldApplySpacing ? spaceBefore : false,
        rightSpace: shouldApplySpacing ? spaceAfter : false,
        explicitSpacing: shouldApplySpacing,
        capNext,
        retroSpace: symbol === "{*?}" ? "insert" : symbol === "{*!}" ? "delete" : null,
        repeat
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
        if (buffer.replaceIslandAt(lastIndex, {
            ...last,
            explicitSpacing: true,
            leftSpace: action === "insert"
        })) {
            changed = true;
        }
        break;
    }
    return changed;
}

// --- Parse / Assemble ---

function parse(stroke) {
    let currentStroke = stroke;
    let capitalize = false;
    if (currentStroke.startsWith("#")) {
        capitalize = true;
        currentStroke = currentStroke.substring(1);
    }

    const onGlide = currentStroke.startsWith("S");
    if (onGlide) currentStroke = currentStroke.substring(1);

    let initialConsonant = "";
    let survived = false;
    
    // Match Initial Consonant (4 -> 1)
    for (let length = 4; length > 0; length--) {
        if (length > currentStroke.length) continue;
        const candidate = currentStroke.substring(0, length);
        if (stenographyMap[candidate] !== undefined) {
            initialConsonant = stenographyMap[candidate];
            currentStroke = currentStroke.substring(length);
            survived = true;
            break;
        }
    }

    let vowel = "";
    survived = false;
    // Match Vowel (4 -> 1)
    for (let length = 4; length > 0; length--) {
        if (length > currentStroke.length) continue;
        const candidate = currentStroke.substring(0, length);
        if (vowelMap[candidate] !== undefined) {
            vowel = vowelMap[candidate];
            currentStroke = currentStroke.substring(length);
            survived = true;
            break;
        }
    }
    if (!survived) return null;

    let finalConsonant = "";
    let finalSteno = "";
    // Match Final Consonant (2 -> 1)
    for (let length = 2; length > 0; length--) {
        if (length > currentStroke.length) continue;
        const candidate = currentStroke.substring(0, length);
        if (finalMap[candidate] !== undefined) {
            finalConsonant = finalMap[candidate];
            finalSteno = candidate;
            currentStroke = currentStroke.substring(length);
            survived = true;
            break;
        }
    }

    let tone = "";
    let toneSteno = "";
    survived = currentStroke.length === 0;
    if (currentStroke.length > 0) {
        if (toneMap[currentStroke] !== undefined) {
            tone = toneMap[currentStroke];
            toneSteno = currentStroke;
            currentStroke = "";
            survived = true;
        }
    }

    if (!survived) return null;
    if (toneSteno === "BL" || toneSteno === "BLG") {
        const stopFinals = { "P": "p", "R": "t", "FR": "c", "RP": "ch" };
        if (stopFinals[finalSteno]) {
            finalConsonant = stopFinals[finalSteno];
            tone = toneSteno === "BL" ? "sắc" : "nặng";
        } else {
            return null;
        }
    }

    return { capitalize, onGlide, initialConsonant, vowel, finalConsonant, tone };
}

function assemble(parsed) {
    const initial = () => {
        const f = ["a", "ă", "â", "o", "ô", "ơ", "u", "ư", "ua/uô", "ưa/ươ"].includes(parsed.vowel);
        if (parsed.initialConsonant === "ng/ngh") {
            return (parsed.onGlide || f) ? "ng" : "ngh";
        }
        if (parsed.initialConsonant === "g") {
            return (parsed.onGlide || f) ? "g" : "gh";
        }
        if (parsed.initialConsonant === "gi") {
            return (!parsed.onGlide && (parsed.vowel === "i" || parsed.vowel === "iê/ia")) ? "g" : "gi";
        }
        if (parsed.initialConsonant === "c") {
            return parsed.onGlide ? "q" : (f ? "c" : "k");
        }
        return parsed.initialConsonant;
    };

    const middle = () => {
        if (parsed.vowel === "iê/ia") {
            if (parsed.initialConsonant === "") {
                if (parsed.onGlide) {
                    if (parsed.finalConsonant === "") return "uy" + toneAccents["a"][parsed.tone];
                    return "uy" + toneAccents["ê"][parsed.tone];
                }
                if (parsed.finalConsonant === "") return toneAccents["i"][parsed.tone] + "a";
                return "y" + toneAccents["ê"][parsed.tone];
            }
            // Has initial consonant
            if (parsed.onGlide) {
                if (parsed.finalConsonant === "") return "uy" + toneAccents["a"][parsed.tone];
                return "uy" + toneAccents["ê"][parsed.tone];
            }
            if (parsed.finalConsonant === "") return toneAccents["i"][parsed.tone] + "a";
            return "i" + toneAccents["ê"][parsed.tone];
        }
        if (parsed.vowel === "ua/uô") {
            return parsed.finalConsonant === ""
                ? toneAccents["u"][parsed.tone] + "a"
                : "u" + toneAccents["ô"][parsed.tone];
        }
        if (parsed.vowel === "ưa/ươ") {
            return parsed.finalConsonant === ""
                ? toneAccents["ư"][parsed.tone] + "a"
                : "ư" + toneAccents["ơ"][parsed.tone];
        }
        if (parsed.vowel === "i") {
            if (parsed.onGlide) {
                if (parsed.finalConsonant === "") {
                    return parsed.initialConsonant !== "c"
                        ? toneAccents["u"][parsed.tone] + "y"
                        : "u" + toneAccents["y"][parsed.tone];
                }
                return "u" + toneAccents["y"][parsed.tone];
            }
            return toneAccents["i"][parsed.tone];
        }
        if (parsed.vowel === "ă" && ["w", "j"].includes(parsed.finalConsonant)) {
            const prefix = parsed.onGlide ? (parsed.initialConsonant === "c" ? "u" : "o") : "";
            return prefix + toneAccents["a"][parsed.tone];
        }
        if (["â", "ê"].includes(parsed.vowel) && parsed.onGlide) {
            return "u" + toneAccents[parsed.vowel][parsed.tone];
        }
        if (parsed.initialConsonant === "c" && parsed.onGlide) {
            return "u" + toneAccents[parsed.vowel][parsed.tone];
        }
        if (parsed.onGlide) {
            return parsed.finalConsonant === ""
                ? toneAccents["o"][parsed.tone] + parsed.vowel
                : "o" + toneAccents[parsed.vowel][parsed.tone];
        }
        return toneAccents[parsed.vowel][parsed.tone];
    };

const final = () => {
        if (parsed.finalConsonant === "w") {
            if ([ "iê/ia", "ư", "ưa/ươ", "ê", "u", "ă", "â", "i" ].includes(parsed.vowel)) {
                return "u";
            }
            return "o";
        }
        if (parsed.finalConsonant === "j") {
            if ([ "ă", "â" ].includes(parsed.vowel)) {
                return "y";
            }
            return "i";
        }
        return parsed.finalConsonant;
    };

    const text = initial() + middle() + final();
    return parsed.capitalize 
        ? text.charAt(0).toUpperCase() + text.slice(1)
        : text;
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
    const lk = (k) => leftKeys.includes(k) ? 1 : 0;
    const cA = lk("#") * 1 + lk("S") * 2 + lk("T") * 4 + lk("P") * 8 + lk("H") * 16;
    const tA = lk("K") * 1 + lk("W") * 2 + lk("R") * 4;
    const vA = lk("A") * 1 + lk("O") * 2;

    const consA = consonantIntMap[cA];
    if (consA === undefined) return null;
    let vowelCharA = vowelIntMap[vA];
    if (vA === 0) vowelCharA = hasSuffixD ? "u" : "e";

    // Right Syllable
    const rk = (k) => rightKeys.includes(k) ? 1 : 0;
    const vB = rk("U") * 1 + rk("E") * 2;
    // F->C4, P->C3, L->C2, T->C0, S->C1
    const cB = rk("T") * 1 + rk("S") * 2 + rk("L") * 4 + rk("P") * 8 + rk("F") * 16;
    // G->T0, B->T1, R->T2
    const tB = rk("G") * 1 + rk("B") * 2 + rk("R") * 4;

    const consB = consonantIntMap[cB];
    if (consB === undefined) return null;
    let vowelCharB = vowelIntMap[vB];
    if (vB === 0) vowelCharB = hasSuffixZ ? "u" : "e";

    return consA + vowelCharA + remapTone(tA) + consB + vowelCharB + remapTone(tB);
}


// --- App State ---

const buffer = new TextBuffer();
const state = {
    get islands() { return buffer.getIslands(); },
    set islands(next) { buffer.setIslands(next); },
    get pendingCapitalization() { return buffer.pendingCapitalization; },
    set pendingCapitalization(next) { buffer.pendingCapitalization = next; },
    candidates: []
};
let isRawMode = false;
let inferenceAbortController = null;
let strippedPlover = {
    available: false,
    enabled: false,
    preeditIndex: null,
    requestId: 0
};
let ploverDictionaries = [];
let ploverSocket = null;
let ploverSocketReady = null;
let ploverSocketReadyReject = null;
let ploverRpcId = 1;
const ploverPending = new Map();
const dictionaryInputIds = new Set([
    "plover-dict-name",
    "plover-entry-stroke",
    "plover-entry-translation"
]);
// Feature detection is performed once to keep behavior consistent for the module's lifetime.
const hasAbortController = typeof AbortController !== "undefined";
let ploverDictionarySignature = "";
const PLOVER_STATUS_RETRY_MS = 2000;
let ploverStatusTimer: ReturnType<typeof setTimeout> | null = null;
let ploverStatusCheckInFlight = false;

function isDictionaryTextInputFocused(target = document.activeElement) {
    return !!(target && dictionaryInputIds.has(target.id));
}

const undoManager = createUndoManager(buffer, () => {
        state.candidates = [];
        syncPloverPreeditIndex();
        updateDisplay();
        runInference();
});

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

function setButtonLoading(button, isLoading, loadingText = "") {
    if (!button) return;
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
            enabled: !!dict.enabled
        }))
    );
}

function updatePloverDictionaries(nextDictionaries, { force = false } = {}) {
    const signature = getDictionarySignature(nextDictionaries);
    if (!force && signature === ploverDictionarySignature) return false;
    ploverDictionarySignature = signature;
    ploverDictionaries = nextDictionaries;
    renderPloverDictionaries();
    return true;
}

function updatePloverStatusUI() {
    const statusEl = document.getElementById("plover-status");
    const toggleButton = document.getElementById("plover-toggle");
    const dictionaryButton = document.getElementById("plover-dictionary-open");
    if (!statusEl || !toggleButton) return;
    if (strippedPlover.available) {
        statusEl.textContent = strippedPlover.enabled ? "Enabled" : "Available";
        statusEl.classList.remove("unavailable");
        statusEl.classList.add("available");
        toggleButton.disabled = false;
        toggleButton.textContent = strippedPlover.enabled ? "Disable" : "Enable";
        if (dictionaryButton) dictionaryButton.disabled = false;
    } else {
        statusEl.textContent = "Unavailable";
        statusEl.classList.remove("available");
        statusEl.classList.add("unavailable");
        toggleButton.disabled = true;
        toggleButton.textContent = "Enable";
        if (dictionaryButton) dictionaryButton.disabled = true;
    }
}

async function fetchPloverStatus() {
    try {
        const resp = await fetch("/plover/status");
        const data = await resp.json();
        strippedPlover.available = !!data.available;
        if (!strippedPlover.available) {
            strippedPlover.enabled = false;
            strippedPlover.preeditIndex = null;
        }
    } catch (e) {
        strippedPlover.available = false;
        strippedPlover.enabled = false;
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
    ploverStatusTimer = window.setTimeout(() => {
        ensurePloverAvailability().catch((err) => console.error("Plover status retry failed:", err));
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
        try { ploverSocket.close(); } catch (e) { /* ignore */ }
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
    strippedPlover.preeditIndex = null;
    ploverDictionarySignature = "";
    ploverDictionaries = [];
    renderPloverDictionaries();
    updatePloverStatusUI();
    schedulePloverStatusRetry();
}

function ensurePloverSocket() {
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

function applyPloverOutput(output, { recordHistory, allowInference, finalizePreedit }) {
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
    const combinedCommitted = finalizePreedit ? `${committedJoined}${preeditText}` : committedJoined;
    const committedText = ensureString(combinedCommitted);
    const normalizedPreedit = finalizePreedit ? "" : ensureString(preeditText);
    const shouldSave = hadPreedit || committedText !== "" || normalizedPreedit !== "";
    if (shouldSave) {
        undoManager.savePlover({ recordHistory: !!recordHistory, hadPreedit });
    }

    clearPloverPreedit();

    if (committedText) {
        buffer.appendIsland(createIsland("vietnamese", committedText, false, { plover: true }));
    }

    if (!finalizePreedit) {
        if (normalizedPreedit) {
            buffer.appendIsland(createIsland("vietnamese", normalizedPreedit, false, { plover: true, ploverPreedit: true }));
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
    if (!strippedPlover.available) return;
    const currentRequest = ++strippedPlover.requestId;
    try {
        const result = await ploverRpc("translate", { stroke });
        if (currentRequest !== strippedPlover.requestId) return;
        applyPloverOutput(result.output || [], {
            recordHistory: oneShot,
            allowInference: true,
            finalizePreedit: oneShot
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
    if (!strippedPlover.available) return;
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
}

async function refreshPloverDictionaries({ force = false } = {}) {
    if (!strippedPlover.available) return;
    try {
        const result = await ploverRpc("get_dictionary_state", {});
        const dictionaries = result.dictionaries || [];
        updatePloverDictionaries(dictionaries, { force });
        setPloverMessage("");
    } catch (e) {
        console.log(e);
        setPloverMessage(e.message || "Failed to load dictionaries.");
    }
}

function updatePloverDictionarySelects() {
    const selectEl = document.getElementById("plover-entry-dict");
    if (!selectEl) return;
    selectEl.replaceChildren();
    const availableDictionaries = ploverDictionaries;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    if (availableDictionaries.length === 0) {
        placeholder.textContent = "No dictionaries available";
    } else {
        placeholder.textContent = "Select a dictionary";
    }
    placeholder.disabled = true;
    placeholder.selected = true;
    selectEl.appendChild(placeholder);
    for (const dict of availableDictionaries) {
        const option = document.createElement("option");
        option.value = dict.identifier;
        option.textContent = dict.readonly
            ? `${dict.identifier} (read-only)`
            : dict.identifier;
        selectEl.appendChild(option);
    }
    selectEl.disabled = availableDictionaries.length === 0;
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
        setEntryMessage(selectEl.disabled
            ? "No dictionaries available."
            : "Select a dictionary to edit entries.");
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

function downloadDictionaryFile(filename, content, mimeType) {
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
            downloadDictionaryFile(filename, result.pythonCode || "", "text/x-python");
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
    if (!nextName || nextName.trim() === "" || nextName.trim() === currentLabel) return;
    setButtonLoading(button, true, "Renaming...");
    try {
        const renamed = nextName.trim();
        const exported = await ploverRpc("export_dictionary", { name });
        if (exported.type === "python") {
            await ploverRpc("import_dictionary", {
                name: renamed,
                type: "python",
                pythonCode: exported.pythonCode || ""
            });
        } else {
            await ploverRpc("import_dictionary", {
                name: renamed,
                type: "json",
                data: exported.data || {},
                merge: false
            });
        }
        if (!dict.enabled) {
            await ploverRpc("set_dictionary_enabled", { identifier: renamed, enabled: false });
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

function renderPloverDictionaries() {
    const listEl = document.getElementById("plover-dictionary-list");
    if (!listEl) return;
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
    for (const dict of ploverDictionaries) {
        const row = document.createElement("div");
        row.className = "plover-dictionary-item";
        const info = document.createElement("div");
        info.className = "plover-dictionary-info";
        const name = dict.identifier;
        const nameEl = document.createElement("div");
        nameEl.className = "plover-dictionary-name";
        nameEl.textContent = name;
        info.appendChild(nameEl);

        const meta = document.createElement("div");
        meta.className = "plover-dictionary-meta";
        meta.textContent = `entries: ${dict.entries ?? 0} · ${dict.readonly ? "read-only" : "writable"} · ${dict.enabled ? "enabled" : "disabled"}`;
        info.appendChild(meta);
        row.appendChild(info);
        const actions = document.createElement("div");
        actions.className = "plover-dictionary-actions";
        const exportButton = document.createElement("button");
        exportButton.textContent = "Export";
        exportButton.addEventListener("click", () => {
            void exportDictionary(dict, exportButton);
        });
        const renameButton = document.createElement("button");
        renameButton.textContent = "Rename";
        renameButton.addEventListener("click", () => {
            void renameDictionary(dict, renameButton);
        });
        const deleteButton = document.createElement("button");
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => {
            void deleteDictionary(dict, deleteButton);
        });
        actions.appendChild(exportButton);
        actions.appendChild(renameButton);
        actions.appendChild(deleteButton);
        row.appendChild(actions);
        listEl.appendChild(row);
    }
    updatePloverDictionarySelects();
}

// --- Logic ---

function appendText(text) {
    if (state.pendingCapitalization && text.length > 0) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
        state.pendingCapitalization = false;
    }
    // Append a new Vietnamese (generic text) island
    buffer.appendIsland(createIsland('vietnamese', text));
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
    if (stroke === "#") {
        await togglePloverMode();
        return;
    }

    if (strippedPlover.enabled) {
        await handlePloverStroke(stroke, { oneShot: false });
        return;
    }

    // 1. Escape Hatch: #S
    if (stroke === "#S-" || stroke === "#S") {
        if (state.candidates.length > 0) {
            selectCandidate(0); // Select top candidate
        }
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
        restoreState();
        return;
    }
    
    // Two-syllable V7 decoding should outrank Emily for overlapping strokes.
    if (stroke.includes("*")) {
        const v7Code = getV7FromStroke(stroke);
        if (v7Code) {
            saveState();
            buffer.appendIsland(createIsland('vietnamese', v7Code, true));
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
            const changed = applyRetroactiveSpace(emilyResult.retroSpace, repeatCount);
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
        buffer.appendIsland(createIsland(emilyResult.type, emilyResult.value, false, {
            leftSpace: emilyResult.leftSpace,
            rightSpace: emilyResult.rightSpace,
            explicitSpacing: emilyResult.explicitSpacing
        }));
        state.pendingCapitalization = emilyResult.capNext || false;
        runInference();
        updateDisplay();
        return;
    }

    // Check single-stroke selection+syllable first; otherwise let normal handlers run.
    const selection = state.candidates.length > 0
        ? getCandidateSelectionMatch(stroke, state.candidates.length)
        : null;
    if (selection && selection.syllableStroke !== null) {
        const combinedPunctuation = PUNCTUATION_MAP[selection.syllableStroke];
        if (combinedPunctuation) {
            saveState();
            if (selectCandidate(selection.candidateIndex, { saveHistory: false, refreshDisplay: false })) {
                buffer.appendIsland(createIsland('punctuation', combinedPunctuation));
                updateDisplay();
                return;
            }
        }
        const parsedSelection = parse(selection.syllableStroke);
        if (parsedSelection) {
            const syllableText = assemble(parsedSelection);
            saveState();
            if (selectCandidate(selection.candidateIndex, { saveHistory: false, refreshDisplay: false })) {
                appendText(syllableText);
                runInference();
                return;
            }
        }
    }

    // 2. Space Stroke: S-P
    if (stroke === "S-P") {
        saveState();
        buffer.appendIsland(createIsland('spacing', ' '));
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
        const punct = PUNCTUATION_MAP[stroke];
        buffer.appendIsland(createIsland('punctuation', punct));
        updateDisplay();
        return;
    }

    const parsed = parse(stroke);
    if (parsed) {
        const text = assemble(parsed);
        saveState();
        appendText(text);
        runInference();
        return;
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
    const hasV7 = state.islands.some(i => i.isV7);
    if (!hasV7) {
        abortInferenceRequest(true);
        state.candidates = [];
        updateDisplay();
        return;
    }

    abortInferenceRequest(false);
    const controller = hasAbortController ? new AbortController() : null;
    inferenceAbortController = controller;

    try {
        // Convert client islands to server format [Fixed, V7, Fixed...]
        const serverIslands = convertIslandsForInference(state.islands);

        const fetchOptions = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ islands: serverIslands }),
            ...(controller ? { signal: controller.signal } : {})
        };

        const resp = await fetch("/infer", fetchOptions);
        if (isStaleInference(controller)) {
            // A newer inference request has started; discard this response.
            return;
        }
        const data = await resp.json();
        if (isStaleInference(controller)) {
            // A newer request may have started while parsing the response.
            return;
        }
        state.candidates = data.candidates;
        updateDisplay();
    } catch (e) {
        if (e && e.name === "AbortError") {
            return;
        }
        console.error("Inference failed", e);
    } finally {
        if (controller && controller === inferenceAbortController) {
            // Only clear if this is still the latest inference request.
            inferenceAbortController = null;
        }
    }
}

type SelectCandidateOptions = {
    saveHistory: boolean;
    refreshDisplay: boolean;
};

function selectCandidate(index, options: SelectCandidateOptions = { saveHistory: true, refreshDisplay: true }) {
    const nextIslands = selectCandidateIslands(state.candidates, index);
    if (!nextIslands) return false;
    if (options.saveHistory) {
        saveState();
    }
    buffer.setIslands(nextIslands);
    state.candidates = [];
    if (options.refreshDisplay) {
        updateDisplay();
    }
    return true;
}

function getCommonPrefix(strings) {
    if (strings.length === 0) return "";
    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
        while (strings[i].indexOf(prefix) !== 0) {
            prefix = prefix.substring(0, prefix.length - 1);
            if (prefix === "") return "";
        }
    }
    
    // Truncate to last space to ensure full syllables
    if (prefix.length > 0 && prefix.length < strings[0].length) {
        const lastSpace = prefix.lastIndexOf(" ");
        if (lastSpace !== -1) {
            prefix = prefix.substring(0, lastSpace + 1);
        } else {
            // No space found, so no common word prefix
            prefix = "";
        }
    }
    
    return prefix;
}

function updateInputPadding(display, textArea, candidateArea) {
    if (!display.dataset.basePaddingBottom) {
        display.dataset.basePaddingBottom = String(parseFloat(getComputedStyle(display).paddingBottom) || 0);
    }
    if (!textArea.dataset.basePaddingBottom) {
        textArea.dataset.basePaddingBottom = String(parseFloat(getComputedStyle(textArea).paddingBottom) || 0);
    }

    const candidateHeight = Math.ceil(candidateArea.getBoundingClientRect().height);
    const displayBase = parseFloat(display.dataset.basePaddingBottom) || 0;
    const textAreaBase = parseFloat(textArea.dataset.basePaddingBottom) || 0;

    display.style.paddingBottom = `${displayBase + candidateHeight}px`;
    textArea.style.paddingBottom = `${textAreaBase + candidateHeight}px`;
}

function scrollToBottom(element) {
    element.scrollTop = element.scrollHeight;
    requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
    });
}

function updateDisplay() {
    const display = document.getElementById("text-display");
    const textArea = document.getElementById("text-input");
    const candArea = document.getElementById("candidate-area");

    const text = renderVisibleText(state.islands, state.candidates);
    
    if (isRawMode) {
        // Raw Mode: Show textarea
        display.style.display = 'none';
        textArea.style.display = 'block';
        if (textArea.value !== text) { // Only update if changed to avoid cursor jumps if loop?
             textArea.value = text;
        }
        candArea.style.display = 'none'; // Hide candidates in raw mode? Usually yes.
    } else {
        // Steno Mode: Show div
        display.style.display = 'block';
        textArea.style.display = 'none';
        candArea.style.display = 'flex';

        // Render text with cursor
        display.replaceChildren(); // clear
        
        // Fix: Cursor should be at the start if placeholder is present
        const cursor = document.createElement("span");
        cursor.id = "cursor";
        display.appendChild(cursor);

        // Check if empty (single empty Viet island)
        const isEmpty = state.islands.length === 1 && state.islands[0].value === "" && !state.islands[0].isV7;

        if (text === "" && isEmpty) {
            const placeholder = document.createElement("span");
            placeholder.textContent = "Start typing with your steno keyboard...";
            placeholder.style.color = "#999";
            display.appendChild(placeholder);
        } else {
            const textNode = document.createTextNode(text);
            display.insertBefore(textNode, cursor); // Text before cursor
            display.style.color = "#000";
        }
        // Render Candidates
        candArea.replaceChildren();
        if (state.candidates.length > 0) {
            // Calculate common prefix for top 5 candidates
            const visibleCandidates = state.candidates.slice(0, 5);
            // Each candidate is array of strings. Join them.
            const candStrings = visibleCandidates.map(c => c.join(""));
            const prefix = getCommonPrefix(candStrings);

            // Check if candidates are short enough for horizontal display
            let maxRemainingLength = 0;
            for (const s of candStrings) {
                maxRemainingLength = Math.max(maxRemainingLength, s.length - prefix.length);
            }
            
            // Threshold: e.g. 15 chars
            if (maxRemainingLength < 15) {
                candArea.classList.add("horizontal");
            } else {
                candArea.classList.remove("horizontal");
            }

            for (let i = 0; i < visibleCandidates.length; i++) {
                const div = document.createElement("div");
                div.className = "candidate";
                
                const sup = document.createElement("sup");
                sup.textContent = i + 1;
                div.appendChild(sup);

                div.appendChild(document.createTextNode(" "));

                const span = document.createElement("span");
                span.className = "candidate-text";

                if (prefix.length > 0) {
                     const prefixSpan = document.createElement("span");
                     prefixSpan.className = "common-prefix";
                     prefixSpan.textContent = "[...]";
                     span.appendChild(prefixSpan);

                     const suffix = candStrings[i].substring(prefix.length);
                     span.appendChild(document.createTextNode(suffix));
                } else {
                     span.textContent = candStrings[i];
                }

                div.appendChild(span);
                div.onclick = () => selectCandidate(i);
                candArea.appendChild(div);
            }
        } else {
            candArea.classList.remove("horizontal");
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
}

// --- Input Handling ---

const keyboardStrokeTracker = new KeyboardStrokeTracker();

document.addEventListener("keydown", (e) => {
    // Global Shortcuts
    if (e.ctrlKey && e.key === 'c') {
        // Copy entire buffer if nothing selected
        if (!window.getSelection().toString()) {
            const textToCopy = renderVisibleText(state.islands, state.candidates);
            
            navigator.clipboard.writeText(textToCopy).catch(err => {
                console.error('Failed to copy: ', err);
            });
            // We can prevent default if we want, but let's allow it to be safe? 
            // Actually request says "Ctrl+C copies the whole buffer when nothing is selected."
            // Standard behavior is copy selected. 
        }
        return; // Allow default processing
    }

    if (isDictionaryTextInputFocused(e.target)) {
        return; // Allow normal typing in dictionary text boxes
    }

    if (isRawMode) {
        if (e.key === "Escape") {
             // Exit Raw Mode
             const textArea = document.getElementById("text-input");
             const newText = textArea.value;
             
             // Update state
             buffer.setIslands([createIsland('vietnamese', newText)]);
             state.candidates = [];
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
             const value = isNumber ? e.key : e.key.toUpperCase();
             buffer.appendIsland(createIsland('capital', value));
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
        buffer.trimTrailingSpaceFromLastVietnameseIsland();
        saveState();
        buffer.appendIsland(createIsland('spacing', '\n'));
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
        buffer.appendIsland(createIsland('capital', mapped));
        runInference();
        e.preventDefault();
        return;
    }
    e.preventDefault();
});

document.addEventListener("keyup", (e) => {
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

function setupPloverControls() {
    const toggleButton = document.getElementById("plover-toggle");
    const dictionaryOpenButton = document.getElementById("plover-dictionary-open");
    const dictionaryDialog = document.getElementById("plover-dictionary-dialog");
    const dictionaryCloseButton = document.getElementById("plover-dictionary-close");
    const refreshButton = document.getElementById("plover-refresh");
    const uploadButton = document.getElementById("plover-dict-upload");
    const addButton = document.getElementById("plover-entry-add");
    const updateButton = document.getElementById("plover-entry-update");
    const removeButton = document.getElementById("plover-entry-remove");
    const dictSelect = document.getElementById("plover-entry-dict");

    if (toggleButton) {
        toggleButton.addEventListener("click", () => {
            void togglePloverMode();
        });
    }
    if (dictionaryOpenButton && dictionaryDialog) {
        dictionaryOpenButton.addEventListener("click", () => {
            if (typeof dictionaryDialog.showModal === "function") {
                dictionaryDialog.showModal();
            } else {
                dictionaryDialog.setAttribute("open", "");
            }
        });
    }
    if (dictionaryCloseButton && dictionaryDialog) {
        dictionaryCloseButton.addEventListener("click", () => {
            if (typeof dictionaryDialog.close === "function") {
                dictionaryDialog.close();
            } else {
                dictionaryDialog.removeAttribute("open");
            }
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
            }
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
    if (uploadButton) {
        uploadButton.addEventListener("click", async () => {
            if (!strippedPlover.available) {
                setPloverMessage("Stripped Plover is unavailable.");
                return;
            }
            const fileInput = document.getElementById("plover-dict-file");
            const nameInput = document.getElementById("plover-dict-name");
            const typeSelect = document.getElementById("plover-dict-type");
            const mergeToggle = document.getElementById("plover-dict-merge");
            const file = fileInput?.files?.[0];
            if (!file) {
                setPloverMessage("Select a dictionary file to upload.");
                return;
            }
            const name = (nameInput?.value || "").trim() || file.name;
            const type = typeSelect?.value || "json";
            setButtonLoading(uploadButton, true, "Uploading...");
            try {
                const content = await file.text();
                if (type === "json") {
                    const data = JSON.parse(content);
                    await ploverRpc("import_dictionary", {
                        name,
                        type: "json",
                        data,
                        merge: !!mergeToggle?.checked
                    });
                } else {
                    await ploverRpc("import_dictionary", {
                        name,
                        type: "python",
                        pythonCode: content
                    });
                }
                await refreshPloverDictionaries({ force: true });
                setPloverMessage("");
            } catch (e) {
                console.log(e);
                setPloverMessage(e.message || "Failed to upload dictionary.");
            } finally {
                setButtonLoading(uploadButton, false, "");
            }
        });
    }

    const entryHandler = async (action) => {
        if (!strippedPlover.available) {
            setEntryMessage("Stripped Plover is unavailable.");
            return;
        }
        const dictSelect = document.getElementById("plover-entry-dict");
        const strokeInput = document.getElementById("plover-entry-stroke");
        const translationInput = document.getElementById("plover-entry-translation");
        const stroke = (strokeInput?.value || "").trim();
        const translation = (translationInput?.value || "").trim();
        const name = (dictSelect?.value || "").trim();
        if (!name) {
            setEntryMessage("Select a dictionary to edit entries.");
            return;
        }
        const selectedDict = ploverDictionaries.find((dict) => dict.identifier === name);
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
}

setupPloverControls();
