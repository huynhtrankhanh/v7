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

let state = {
    islands: [""],
    candidates: []
};
let history = [];
let isRawMode = false;

function saveState(isReplace = false) {
    if (isReplace) {
        history.push({ islands: [...state.islands] });
    } else {
        history.push({
            islandsRef: state.islands,
            len: state.islands.length,
            lastItem: state.islands.length > 0 ? state.islands[state.islands.length - 1] : null
        });
    }
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
        state.candidates = [];
        updateDisplay();
        runInference();
    }
}

// --- Logic ---

function appendText(text) {
    if (state.islands.length % 2 === 0) {
        // We are at a V7 island index (though usually we shouldn't be appending fixed text here unless transitioning?)
        // Actually, V7 architecture assumes Fixed - V7 - Fixed - V7 ...
        // If we append fixed text, we usually append to the last Fixed island (odd index? No, index 0 is Fixed).
        // 0: Fixed. 1: V7. 2: Fixed. 
        // If length is even (2), we are about to push a fixed text island at index 2.
        state.islands.push(text);
    } else {
        // Length is odd (e.g., 1). Last item is Fixed (index 0).
        const current = state.islands[state.islands.length - 1];
        // Don't add space if current is empty or ends with space/newline
        const needsSpace = current.length > 0 && !current.endsWith(" ") && !current.endsWith("\n");
        state.islands[state.islands.length - 1] = current + (needsSpace ? " " : "") + text;
    }
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
    
    // Check Selection
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
        // Force append a space
        if (state.islands.length % 2 === 0) {
             state.islands.push(" ");
        } else {
             state.islands[state.islands.length - 1] += " ";
        }
        runInference(); // Update context if needed? Mostly just text update.
        updateDisplay();
        return;
    }

    // 3. Punctuation
    const punctuationMap = {
        "TP-PL": ". ",
        "KW-BG": ", ",
        "KW-PL": "? ",
        "TP-BG": "! "
    };

    if (punctuationMap[stroke]) {
        // Fix: Auto-select candidate if present
        if (state.candidates.length > 0) {
            selectCandidate(0);
        }

        saveState();
        const punct = punctuationMap[stroke];
        // Append punctuation directly, handling spacing carefully
        if (state.islands.length % 2 === 0) {
             state.islands.push(punct);
        } else {
             state.islands[state.islands.length - 1] += punct;
        }
        updateDisplay();
        return;
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
    saveState(true);
    state.islands = [chosenText];
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
        text = state.candidates[0].filter(s => s.length > 0).join(" ");
    } else {
        // Fallback: Show all islands, wrapping V7 codes in brackets
        // Fix: Don't add space if previous island ends with newline
        text = state.islands.map((s, i) => i % 2 !== 0 ? "[" + s + "]" : s)
            .reduce((acc, curr) => {
                if (acc === "") return curr;
                if (acc.endsWith("\n")) return acc + curr;
                return acc + " " + curr;
            }, "");
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
        display.innerHTML = ""; // clear
        
        // Fix: Cursor should be at the start if placeholder is present
        const cursor = document.createElement("span");
        cursor.id = "cursor";
        display.appendChild(cursor);

        if (text === "" && state.islands.length === 1 && state.islands[0] === "") {
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
                     textHtml = "<span class=\"common-prefix\">[...]</span>" + suffix;
                }

                div.innerHTML = `<sup>${i + 1}</sup> <span class="candidate-text">${textHtml}</span>`;
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
    // Global Shortcuts
    if (e.ctrlKey && e.key === 'c') {
        // Copy entire buffer if nothing selected
        if (!window.getSelection().toString()) {
            const textToCopy = state.candidates.length > 0 
                ? state.candidates[0].filter(s => s.length > 0).join(" ") 
                : state.islands.map((s, i) => i % 2 !== 0 ? "[" + s + "]" : s)
                    .reduce((acc, curr) => {
                        if (acc === "") return curr;
                        if (acc.endsWith("\n")) return acc + curr;
                        return acc + " " + curr;
                    }, "");
            
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
             state.islands = [newText];
             state.candidates = [];
             history = []; // Clear undo
             isRawMode = false;
             
             updateDisplay();
             e.preventDefault();
        }
        return; // Let other keys pass to textarea
    }

    if (e.repeat) return;

    // Handle Literal Uppercase (Shift + Letter)
    if (e.shiftKey && e.key.length === 1 && e.key.match(/[a-z]/i)) {
         // Should we check if it is part of steno?
         // User requested: "SHIFT+ a letter to append an upper case letter literally."
         saveState();
         appendText(e.key.toUpperCase());
         updateDisplay();
         e.preventDefault();
         return;
    }
    
    // Handle Enter for Newline
    if (e.key === "Enter") {
        saveState();
        if (state.islands.length % 2 === 0) {
             state.islands.push("\n");
        } else {
             state.islands[state.islands.length - 1] += "\n";
        }
        updateDisplay();
        e.preventDefault();
        return;
    }

    const mapped = mapKeyUnique(e.key);
    if (!mapped) return;
    
    heldKeys.add(mapped);
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
