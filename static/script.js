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
            if (["iê/ia", "ư", "ưa/ươ", "ê", "u", "ă", "â", "i"].includes(parsed.vowel)) {
                return "u";
            }
            return "o";
        }
        if (parsed.finalConsonant === "j") {
            if (["ă", "â"].includes(parsed.vowel)) {
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
        const candIndex = { "TK": 0, "PW": 1, "HR": 2, "-FR": 3, "-PB": 4 }[stroke];
        if (candIndex !== undefined) {
            selectCandidate(candIndex);
            return;
        }
    }

    if (stroke.includes("*")) {
        const v7Code = getV7FromStroke(stroke);
        if (v7Code) {
            saveState();
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

    const cleanStroke = stroke.replace("-", "");
    const parsed = parse(cleanStroke);
    if (parsed) {
        const text = assemble(parsed);
        saveState();
        if (state.islands.length % 2 === 0) {
             state.islands.push(text + " ");
        } else {
             state.islands[state.islands.length - 1] += text + " ";
        }
        runInference();
        return;
    }

    console.log("Ignored stroke:", stroke);
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
    const chosenText = state.candidates[index].filter(s => s.length > 0).join(" ");
    saveState();
    state.islands = [chosenText + " "];
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
    const candArea = document.getElementById("candidate-area");

    let text = "";
    if (state.candidates.length > 0) {
        // Preview top candidate
        text = state.candidates[0].filter(s => s.length > 0).join(" ");
    } else {
        // Fallback: Show all islands, wrapping V7 codes in brackets
        text = state.islands.map((s, i) => i % 2 !== 0 ? "[" + s + "]" : s).join("");
    }
    
    // Remove the initial placeholder if it exists
    if (text === "" && state.islands.length === 1 && state.islands[0] === "") {
        display.textContent = "Start typing with your steno keyboard...";
        display.style.color = "#999";
    } else {
        display.textContent = text;
        display.style.color = "#000";
    }
    display.scrollTop = display.scrollHeight;

    candArea.innerHTML = "";
    if (state.candidates.length > 0) {
        // Calculate common prefix for top 5 candidates
        const visibleCandidates = state.candidates.slice(0, 5);
        const candStrings = visibleCandidates.map(c => c.filter(s => s.length > 0).join(" ") || " ");
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
            
            let textHtml = candStrings[i];
            if (prefix.length > 0) {
                 const suffix = candStrings[i].substring(prefix.length);
                 textHtml = `<span class="common-prefix">[...]</span>${suffix}`;
            }

            div.innerHTML = `<span class="candidate-text">${textHtml}</span>`;
            div.onclick = () => selectCandidate(i);
            candArea.appendChild(div);
        }
    } else {
        candArea.classList.remove("horizontal");
        const div = document.createElement("div");
        div.className = "candidate";
        div.style.cursor = "default";
        div.innerHTML = '<span class="candidate-text" style="color: #999; text-align: center;">No candidates</span>';
        candArea.appendChild(div);
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
        const middleKeys = ["A", "O", "*", "E", "U"];
        const hasMiddle = middleKeys.some(k => strokeKeys.has(k));
        
        let strokeStr = "";
        for (const k of order) {
             if (k === "E" && !hasMiddle) { // Insert '-' before right side keys start (which is around where E/U are)
                 // actually standard steno notation puts hyphen where the vowel would be.
                 // In our order list, A O * E U are the vowels/middle.
                 // If none of them are present, we insert hyphen after O and before E?
                 // Wait, the logic is: if no vowels/star, then hyphen separates left from right.
                 // Let's just insert it once at the correct position.
                 // The loop iterates in order.
                 // We can insert it when we reach the first "right-side" key if we haven't seen a middle key.
                 // Right side keys: -F, -R, -P, -B, -L, -G, -T, -S, -D, -Z.
                 // Also E and U are vowels but often on right hand side physically but logically middle.
                 // But wait, our `order` has E and U after *.
                 // If we have no middle keys (A, O, *, E, U), we need a hyphen.
                 // Where? Before the first right-side key.
                 // Right side keys in `order`: -F, -R ...
                 // So if we are at -F (or later) and we haven't printed any middle keys, print -.
                 // BUT we need to print it only once.
             }
        }
        
        // Simpler approach:
        strokeStr = "";
        let insertedHyphen = false;
        const rightStart = order.indexOf("-F"); // Index of first right-side consonant
        
        for (let i = 0; i < order.length; i++) {
            const k = order[i];
            
            // Logic to insert hyphen if missing middle keys
            if (!hasMiddle && !insertedHyphen && i >= rightStart) {
                 // Check if we actually have any right side keys to print, 
                 // OR if we just need to indicate separation.
                 // Steno rules: TPH-LG. 
                 // If we just have TPH, it is TPH. 
                 // If we have LG, it is -LG.
                 // So if we are traversing and we hit a right-side key that is present,
                 // and we haven't seen middle keys, we must have a hyphen before it.
                 // BUT if we have NO left keys, does it matter? Yes -LG.
                 
                 // So, if we are at a right side key, and it is present, and !hasMiddle, 
                 // we prepend hyphen if not already added.
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