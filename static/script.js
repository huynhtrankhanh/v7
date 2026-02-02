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
    "FP": "j", "F": "w", "P": "p", "R": "t", "FR": "c", "RB": "ch",
    "PB": "nh", "L": "n", "PL": "m", "B": "ng",
};

const toneMap = {
    "T": "sắc", "S": "huyền", "G": "hỏi", "TS": "ngã", "GS": "nặng",
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
        capNext
    };
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
    // Match Final Consonant (2 -> 1)
    for (let length = 2; length > 0; length--) {
        if (length > currentStroke.length) continue;
        const candidate = currentStroke.substring(0, length);
        if (finalMap[candidate] !== undefined) {
            finalConsonant = finalMap[candidate];
            currentStroke = currentStroke.substring(length);
            survived = true;
            break;
        }
    }

    let tone = "";
    survived = currentStroke.length === 0;
    if (currentStroke.length > 0) {
        if (toneMap[currentStroke] !== undefined) {
            tone = toneMap[currentStroke];
            currentStroke = "";
            survived = true;
        }
    }

    if (!survived) return null;

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

// --- Island Logic ---

function createIsland(type, value, isV7 = false, meta = {}) {
    return { type, value, isV7, ...meta };
}

function shouldAddSpace(prev, curr) {
    if (!prev || !curr) return false;
    if (prev.value === "" && !prev.isV7) return false;
    // Spacing Island (space/newline) never needs added space around it
    if (prev.type === 'spacing' || curr.type === 'spacing') return false;

    // Explicit spacing metadata (Emily symbols)
    if (prev.explicitSpacing || curr.explicitSpacing) {
        return !!(prev.rightSpace) || !!(curr.leftSpace);
    }

    // Punctuation
    if (curr.type === 'punctuation') return false; // No space before punct
    if (prev.type === 'punctuation') return true;  // Space after punct (unless curr is spacing, handled above)

    // Capital (now includes numbers)
    if (prev.type === 'capital') {
        // No space between capitals or following text (e.g. "The")
        if (curr.type === 'capital') return false;
        return true;
    }

    // Vietnamese (or generic Text)
    if (prev.type === 'vietnamese') {
        // Viet -> Viet: Space
        if (curr.type === 'vietnamese') return true;
        // Viet -> Capital: Space
        if (curr.type === 'capital') return true;
    }

    return false;
}

function convertIslandsForInference(islands) {
    const serverIslands = [];
    let currentFixed = "";

    for (let i = 0; i < islands.length; i++) {
        const curr = islands[i];

        if (curr.isV7) {
            // V7 Island: Must be in V7 slot (odd index)
            // If currentFixed is not empty, push it (even index)
            // But check spacing between previous item and this V7
            const prev = i > 0 ? islands[i-1] : null;
            if (prev && shouldAddSpace(prev, curr)) {
                currentFixed += " ";
            }

            serverIslands.push(currentFixed);
            serverIslands.push(curr.value);
            currentFixed = "";
        } else {
            // Fixed Island (Viet/Punct/Cap/Space)
            // Append to currentFixed
            const prev = i > 0 ? islands[i-1] : null;
            if (prev && shouldAddSpace(prev, curr)) {
                currentFixed += " ";
            }
            currentFixed += curr.value;
        }
    }

    serverIslands.push(currentFixed);
    return serverIslands;
}

// --- App State ---

let state = {
    islands: [createIsland('vietnamese', '')], // Start with empty generic island
    candidates: [],
    pendingCapitalization: false
};
let history = [];
let isRawMode = false;
let inferenceAbortController = null;
const isAbortControllerAvailable = typeof AbortController !== "undefined";

function saveState(isReplace = false) {
    const snapshot = { pendingCapitalization: state.pendingCapitalization };
    if (isReplace) {
        snapshot.islands = state.islands.map(i => ({...i}));
    } else {
        snapshot.islandsRef = state.islands;
        snapshot.len = state.islands.length;
        snapshot.lastItem = state.islands.length > 0 ? {...state.islands[state.islands.length - 1]} : null;
    }
    history.push(snapshot);
}

function restoreState() {
    if (history.length > 0) {
        const snapshot = history.pop();
        if (snapshot.islands) {
            state.islands = snapshot.islands;
        } else if (snapshot.islandsRef) {
            state.islands = snapshot.islandsRef;
            state.islands.length = snapshot.len;
            if (snapshot.len > 0 && snapshot.lastItem !== null) {
                state.islands[snapshot.len - 1] = snapshot.lastItem;
            }
        }
        if (snapshot.pendingCapitalization !== undefined) {
            state.pendingCapitalization = snapshot.pendingCapitalization;
        }
        state.candidates = [];
        updateDisplay();
        runInference();
    }
}

// --- Logic ---

function appendText(text) {
    if (state.pendingCapitalization && text.length > 0) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
        state.pendingCapitalization = false;
    }
    // Append a new Vietnamese (generic text) island
    state.islands.push(createIsland('vietnamese', text));
}

function handleChord(stroke) {
    // 1. Escape Hatch: #S
    if (stroke === "#S-" || stroke === "#S") {
        if (state.candidates.length > 0) {
            selectCandidate(0); // Select top candidate
        }
        isRawMode = true;
        history = []; // Clear undo buffer
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
        if (history.length > 0) restoreState();
        return;
    }
    
    // Check Selection (allow explicit candidate selection; do not block other input)
    if (state.candidates.length > 0) {
        const candIndex = { "TK": 0, "PW": 1, "HR": 2, "-FR": 3, "-PB": 4 }[stroke];
        if (candIndex !== undefined) {
            selectCandidate(candIndex);
            return;
        }
    }

    // 2. Space Stroke: S-P
    if (stroke === "S-P") {
        saveState();
        state.islands.push(createIsland('spacing', ' '));
        runInference();
        updateDisplay();
        return;
    }

    // 3. Punctuation
    const punctuationMap = {
        "TP-PL": ".",
        "KW-BG": ",",
        "KW-PL": "?",
        "TP-BG": "!"
    };

    if (punctuationMap[stroke]) {
        // Auto-select candidate if present
        if (state.candidates.length > 0) {
            selectCandidate(0);
        }

        saveState();
        const punct = punctuationMap[stroke];
        state.islands.push(createIsland('punctuation', punct));
        updateDisplay();
        return;
    }

    // Emily symbols starter: SKWH family
    if (stroke.startsWith("SKWH")) {
        const emilyResult = handleEmilySymbol(stroke);
        if (emilyResult) {
            saveState();
            // spacing rules handled by shouldAddSpace; emilyResult.value already includes symbol
            state.islands.push(createIsland(emilyResult.type, emilyResult.value, false, {
                leftSpace: emilyResult.leftSpace,
                rightSpace: emilyResult.rightSpace,
                explicitSpacing: emilyResult.explicitSpacing
            }));
            state.pendingCapitalization = emilyResult.capNext || false;
            runInference();
            updateDisplay();
            return;
        }
    }

    if (stroke.includes("*")) {
        const v7Code = getV7FromStroke(stroke);
        if (v7Code) {
            saveState();
            state.islands.push(createIsland('vietnamese', v7Code, true));
            runInference();
            return;
        }
    }

    const parsed = parse(stroke);
    if (parsed) {
        const text = assemble(parsed);
        saveState();
        appendText(text);
        runInference();
        return;
    }

    console.log("Ignored stroke:", stroke);
}

async function runInference() {
    // Optimization: If no V7 islands, skip inference
    const hasV7 = state.islands.some(i => i.isV7);
    if (!hasV7) {
        if (inferenceAbortController) {
            inferenceAbortController.abort();
            inferenceAbortController = null;
        }
        state.candidates = [];
        updateDisplay();
        return;
    }

    if (inferenceAbortController) {
        inferenceAbortController.abort();
    }
    const controller = isAbortControllerAvailable ? new AbortController() : null;
    inferenceAbortController = controller;
    const requestController = controller;

    try {
        // Convert client islands to server format [Fixed, V7, Fixed...]
        const serverIslands = convertIslandsForInference(state.islands);

        const fetchOptions = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ islands: serverIslands })
        };
        if (requestController) {
            fetchOptions.signal = requestController.signal;
        }

        const resp = await fetch("/infer", fetchOptions);
        const data = await resp.json();
        if (requestController && requestController !== inferenceAbortController) {
            // Ignore stale responses from superseded requests.
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
        if (requestController && requestController === inferenceAbortController) {
            inferenceAbortController = null;
        }
    }
}

function selectCandidate(index) {
    if (!state.candidates[index]) return;
    // state.candidates[index] is array of strings [Fixed, V7, Fixed...] from server response
    // We join them (spacing is already baked into the Fixed parts by convertIslandsForInference + Server)
    const chosenText = state.candidates[index].join("");
    saveState(true);
    state.islands = [createIsland('vietnamese', chosenText)];
    state.candidates = [];
    updateDisplay();
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

function updateDisplay() {
    const display = document.getElementById("text-display");
    const textArea = document.getElementById("text-input");
    const candArea = document.getElementById("candidate-area");

    let text = "";
    if (state.candidates.length > 0) {
        // Preview top candidate
        // state.candidates[0] is array of strings. Join them.
        text = state.candidates[0].join("");
    } else {
        // Fallback: Show all islands using spacing rules
        text = "";
        for (let i = 0; i < state.islands.length; i++) {
            const curr = state.islands[i];
            const prev = i > 0 ? state.islands[i-1] : null;

            if (prev && shouldAddSpace(prev, curr)) {
                text += " ";
            }

            // For V7 islands not yet inferred/candidate-selected, show code in brackets?
            if (curr.isV7) {
                text += "[" + curr.value + "]";
            } else {
                text += curr.value;
            }
        }
    }
    
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
        
        display.scrollTop = display.scrollHeight;

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
}

// --- Input Handling ---

const qwertyToUnique = {
    "q": "#", "a": "S-", "w": "T-", "s": "K-", "e": "P-", "d": "W-", "r": "H-", "f": "R-",
    "c": "A", "v": "O",
    "n": "E", "m": "U",
    "u": "-F", "j": "-R", "i": "-P", "k": "-B", "o": "-L", "l": "-G", "p": "-T", ";": "-S",
    " ": "*"
};

function mapKeyUnique(k) {
    k = k.toLowerCase();
    if (k === "t" || k === "g") return "-D";
    if (k === "y" || k === "h") return "-Z";
    if (k >= "0" && k <= "9") return k; // numbers handled as literal inputs
    return qwertyToUnique[k] || null;
}

let heldKeys = new Set();
let strokeKeys = new Set();

document.addEventListener("keydown", (e) => {
    // Global Shortcuts
    if (e.ctrlKey && e.key === 'c') {
        // Copy entire buffer if nothing selected
        if (!window.getSelection().toString()) {
            let textToCopy = "";
            if (state.candidates.length > 0) {
                 textToCopy = state.candidates[0].join("");
            } else {
                 for (let i = 0; i < state.islands.length; i++) {
                     const curr = state.islands[i];
                     const prev = i > 0 ? state.islands[i-1] : null;
                     if (prev && shouldAddSpace(prev, curr)) textToCopy += " ";
                     if (curr.isV7) textToCopy += "[" + curr.value + "]";
                     else textToCopy += curr.value;
                 }
            }
            
            navigator.clipboard.writeText(textToCopy).catch(err => {
                console.error('Failed to copy: ', err);
            });
            // We can prevent default if we want, but let's allow it to be safe? 
            // Actually request says "Ctrl+C copies the whole buffer when nothing is selected."
            // Standard behavior is copy selected. 
        }
        return; // Allow default processing
    }

    if (isRawMode) {
        if (e.key === "Escape") {
             // Exit Raw Mode
             const textArea = document.getElementById("text-input");
             const newText = textArea.value;
             
             // Update state
             state.islands = [createIsland('vietnamese', newText)];
             state.candidates = [];
             history = []; // Clear undo
             isRawMode = false;
             
             updateDisplay();
             e.preventDefault();
        }
        return; // Let other keys pass to textarea
    }

    if (e.repeat) return;

    // Handle Literal Uppercase (Shift + Letter) and literal numbers as capitals
    if (e.key.length === 1) {
         const isLetter = e.key.match(/[a-z]/i);
         const isNumber = e.key.match(/[0-9]/);
         if ((e.shiftKey && isLetter) || isNumber) {
             saveState();
             const value = isNumber ? e.key : e.key.toUpperCase();
             state.islands.push(createIsland('capital', value));
             runInference();
             e.preventDefault();
             return;
         }
    }
    
    // Handle Enter for Newline
    if (e.key === "Enter") {
        saveState();
        state.islands.push(createIsland('spacing', '\n'));
        runInference();
        updateDisplay();
        e.preventDefault();
        return;
    }

    const mapped = mapKeyUnique(e.key);
    if (!mapped) return;
    
    heldKeys.add(mapped);
    // Numbers should generate immediate capital island, not be part of steno chord
    if (mapped.match(/^[0-9]$/)) {
        // Emit as capital/number island immediately
        saveState();
        state.islands.push(createIsland('capital', mapped));
        runInference();
        e.preventDefault();
        return;
    }
    strokeKeys.add(mapped);
    e.preventDefault();
});

document.addEventListener("keyup", (e) => {
    if (isRawMode) return; // Don't process steno in raw mode

    const mapped = mapKeyUnique(e.key);
    if (!mapped) return;
    
    heldKeys.delete(mapped);
    
    if (heldKeys.size === 0 && strokeKeys.size > 0) {
        // Serialize Stroke
        const order = ["#", "S-", "T-", "K-", "P-", "W-", "H-", "R-", "A", "O", "*", "E", "U", "-F", "-R", "-P", "-B", "-L", "-G", "-T", "-S", "-D", "-Z"];
        const middleKeys = ["A", "O", "*", "E", "U"];
        const hasMiddle = middleKeys.some(k => strokeKeys.has(k));
        
        let strokeStr = "";
        let insertedHyphen = false;
        const rightStart = order.indexOf("-F"); // Index of first right-side consonant
        
        for (let i = 0; i < order.length; i++) {
            const k = order[i];
            
            // Logic to insert hyphen if missing middle keys
            if (!hasMiddle && !insertedHyphen && i >= rightStart) {
                 if (strokeKeys.has(k)) {
                     strokeStr += "-";
                     insertedHyphen = true;
                 }
            }
            
            if (strokeKeys.has(k)) {
                strokeStr += k.replace("-", "");
            }
        }
        
        handleChord(strokeStr);
        strokeKeys = new Set();
    }
});
