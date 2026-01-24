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
    "FP": "j", "F": "w", "P": "p", "R": "t", "BG": "c", "RB": "ch",
    "PB": "nh", "L": "n", "PL": "m", "G": "ng",
};

const toneMap = {
    "T": "sắc", "S": "huyền", "D": "hỏi", "TS": "ngã", "Z": "nặng",
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

// --- Parse / Assemble ---

function parse(stroke) {
    let currentStroke = stroke;
    const onGlide = currentStroke.startsWith("S");
    if (onGlide) currentStroke = currentStroke.substring(1);

    let initialConsonant = "";
    let foundInitial = false;
    // Sort by length desc
    const initialKeys = Object.keys(stenographyMap).sort((a, b) => b.length - a.length);
    for (const key of initialKeys) {
        if (currentStroke.startsWith(key)) {
            initialConsonant = stenographyMap[key];
            currentStroke = currentStroke.substring(key.length);
            foundInitial = true;
            break;
        }
    }

    let vowel = "";
    let foundVowel = false;
    const vowelKeys = Object.keys(vowelMap).sort((a, b) => b.length - a.length);
    for (const key of vowelKeys) {
        if (currentStroke.startsWith(key)) {
            vowel = vowelMap[key];
            currentStroke = currentStroke.substring(key.length);
            foundVowel = true;
            break;
        }
    }
    if (!foundVowel) return null;

    let finalConsonant = "";
    const finalKeys = Object.keys(finalMap).sort((a, b) => b.length - a.length);
    for (const key of finalKeys) {
        if (currentStroke.startsWith(key)) {
            finalConsonant = finalMap[key];
            currentStroke = currentStroke.substring(key.length);
            break;
        }
    }
    if (!finalConsonant) finalConsonant = "";

    let tone = "";
    if (currentStroke.length > 0) {
        if (toneMap[currentStroke] !== undefined) {
            tone = toneMap[currentStroke];
            currentStroke = "";
        } else {
            return null;
        }
    }

    if (currentStroke.length !== 0) return null;

    return { onGlide, initialConsonant, vowel, finalConsonant, tone };
}

function assemble(parsed) {
    const initial = () => {
        const f = ["a", "ă", "â", "o", "ô", "ơ", "u", "ư", "ua/uô", "ưa/ươ"].includes(parsed.vowel);
        switch (parsed.initialConsonant) {
            case "ng/ngh": return (parsed.onGlide || f) ? "ng" : "ngh";
            case "g": return (parsed.onGlide || f) ? "g" : "gh";
            case "gi": return (!parsed.onGlide && parsed.vowel === "i") ? "g" : "gi";
            case "c":
                if (parsed.onGlide) return "q";
                return f ? "c" : "k";
            default: return parsed.initialConsonant;
        }
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
            return (parsed.onGlide
                ? (parsed.initialConsonant === "c" ? "u" : "o")
                : ""
            ) + toneAccents["a"][parsed.tone];
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
            return ["iê/ia", "ư", "ê", "u", "ă", "â", "i"].includes(parsed.vowel) ? "u" : "o";
        }
        if (parsed.finalConsonant === "j") {
            return ["ă", "â"].includes(parsed.vowel) ? "y" : "i";
        }
        return parsed.finalConsonant;
    };

    return initial() + middle() + final();
}

// --- V7 Decoding ---

function getV7FromStroke(stroke) {
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

    return consA + vowelCharA + tA + consB + vowelCharB + tB;
}

// --- App State ---

let state = {
    islands: [""],
    candidates: []
};
let history = [];

function saveState() {
    history.push(JSON.stringify(state));
}

function restoreState() {
    if (history.length > 0) {
        state = JSON.parse(history.pop());
        updateDisplay();
        // Recalculate inference if we went back to ambiguous state?
        // Yes, if we undid a selection, we might be back to candidates.
        // But `state.candidates` is preserved in JSON.
    }
}

// --- Logic ---

function handleChord(stroke) {
    if (stroke === "*") {
        if (history.length > 0) restoreState();
        return;
    }
    
    // Check Selection
    if (state.candidates.length > 0) {
        const candIndex = { "TK": 0, "PW": 1, "HR": 2, "FR": 3, "PB": 4 }[stroke];
        if (candIndex !== undefined) {
            selectCandidate(candIndex);
            return;
        }
    }

    saveState();

    if (stroke.includes("*")) {
        const v7Code = getV7FromStroke(stroke);
        if (v7Code) {
            if (state.islands.length % 2 !== 0) {
                state.islands.push(v7Code);
            } else {
                state.islands.push("");
                state.islands.push(v7Code);
            }
            runInference();
            return;
        }
    }

    const parsed = parse(stroke);
    if (parsed) {
        const text = assemble(parsed);
        if (state.islands.length % 2 === 0) {
             state.islands.push(text + " ");
        } else {
             state.islands[state.islands.length - 1] += text + " ";
        }
        runInference();
        return;
    }
}

async function runInference() {
    try {
        const resp = await fetch("/infer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ islands: state.islands })
        });
        const data = await resp.json();
        state.candidates = data.candidates;
        updateDisplay();
    } catch (e) {
        console.error("Inference failed", e);
    }
}

function selectCandidate(index) {
    if (!state.candidates[index]) return;
    const chosenText = state.candidates[index].join(" ");
    saveState();
    state.islands = [chosenText + " "];
    state.candidates = [];
    updateDisplay();
}

function updateDisplay() {
    const display = document.getElementById("text-display");
    const candArea = document.getElementById("candidate-area");

    let text = "";
    if (state.candidates.length > 0) {
        // Preview top candidate
        text = state.candidates[0].join(" ");
    } else {
        text = state.islands.filter((_, i) => i % 2 === 0).join(" ");
    }
    
    display.textContent = text;
    display.scrollTop = display.scrollHeight;

    candArea.innerHTML = "";
    if (state.candidates.length > 0) {
        const chords = ["TK", "PW", "HR", "-FR", "-PB"];
        for (let i = 0; i < Math.min(state.candidates.length, 5); i++) {
            const div = document.createElement("div");
            div.className = "candidate";
            div.innerHTML = `<span class="candidate-chord">${chords[i]}</span><span class="candidate-text">${state.candidates[i].join(" ")}</span>`;
            div.onclick = () => selectCandidate(i);
            candArea.appendChild(div);
        }
    } else {
        candArea.innerHTML = '<div class="candidate">No candidates</div>';
    }
}

// --- Input Handling ---

const qwertyToUnique = {
    "q": "#", "a": "S-", "w": "T-", "s": "K-", "e": "P-", "d": "W-", "r": "H-", "f": "R-",
    "c": "A", "v": "O",
    "n": "E", "m": "U",
    "u": "-F", "j": "-R", "i": "-P", "k": "-B", "o": "-L", "l": "-G", "p": "-T", ";": "-S",
    " ": "*", "[": "-D", "]": "-Z"
};

function mapKeyUnique(k) {
    k = k.toLowerCase();
    if (k === "t" || k === "g") return "-D";
    if (k === "y" || k === "h") return "-Z";
    return qwertyToUnique[k] || null;
}

let heldKeys = new Set();
let strokeKeys = new Set();

document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const mapped = mapKeyUnique(e.key);
    if (!mapped) return;
    
    heldKeys.add(mapped);
    strokeKeys.add(mapped);
    e.preventDefault();
});

document.addEventListener("keyup", (e) => {
    const mapped = mapKeyUnique(e.key);
    if (!mapped) return;
    
    heldKeys.delete(mapped);
    
    if (heldKeys.size === 0 && strokeKeys.size > 0) {
        // Serialize Stroke
        const order = ["#", "S-", "T-", "K-", "P-", "W-", "H-", "R-", "A", "O", "*", "E", "U", "-F", "-R", "-P", "-B", "-L", "-G", "-T", "-S", "-D", "-Z"];
        let strokeStr = "";
        for (const k of order) {
            if (strokeKeys.has(k)) strokeStr += k.replace("-", "");
        }
        
        handleChord(strokeStr);
        strokeKeys = new Set();
    }
});