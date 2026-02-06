// Reverse algorithm: Vietnamese syllable -> stenography stroke
// Space complexity: O(1) (iterates candidates per syllable without precomputing tables)

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

// Reverse lookup: accented char -> { base, tone }
const accentToTone = (() => {
    const map = {};
    for (const [base, tones] of Object.entries(toneAccents)) {
        for (const [tone, char] of Object.entries(tones)) {
            map[char] = { base, tone };
        }
    }
    return map;
})();

// --- Forward helpers copied from static/script.js ---
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

// --- Reverse syllable -> stroke ---
const capitalOptions = ["", "#"];
const glideOptions = ["", "S"];
const initialOptions = ["", ...Object.keys(stenographyMap)];
const vowelOptions = Object.keys(vowelMap);
const finalOptions = ["", ...Object.keys(finalMap)];
const toneOptions = ["", ...Object.keys(toneMap)];

function strokeToVietnamese(stroke) {
    const parsed = parse(stroke);
    return parsed ? assemble(parsed) : null;
}

function syllableToStroke(targetSyllable) {
    if (!targetSyllable) return null;
    // Iterate through candidate strokes without storing them (O(1) space)
    for (const cap of capitalOptions) {
        for (const glide of glideOptions) {
            for (const initial of initialOptions) {
                for (const vowel of vowelOptions) {
                    for (const final of finalOptions) {
                        for (const tone of toneOptions) {
                            const stroke = cap + glide + initial + vowel + final + tone;
                            const parsed = parse(stroke);
                            if (!parsed) continue;
                            const syllable = assemble(parsed);
                            if (syllable === targetSyllable) {
                                return stroke;
                            }
                        }
                    }
                }
            }
        }
    }
    return null;
}

// Exhaustive stress test (valid syllables) when executed directly
if (require.main === module) {
    let total = 0;
    for (const cap of capitalOptions) {
        for (const glide of glideOptions) {
            for (const initial of initialOptions) {
                for (const vowel of vowelOptions) {
                    for (const final of finalOptions) {
                        for (const tone of toneOptions) {
                            const stroke = cap + glide + initial + vowel + final + tone;
                            const parsed = parse(stroke);
                            if (!parsed) continue;
                            const syllable = assemble(parsed);
                            total++;
                            const back = syllableToStroke(syllable);
                            if (!back) {
                                throw new Error(`No reverse stroke for syllable ${syllable}`);
                            }
                            const forward = strokeToVietnamese(back);
                            if (forward !== syllable) {
                                throw new Error(`Roundtrip mismatch for ${syllable}: got ${forward}`);
                            }
                        }
                    }
                }
            }
        }
    }
    console.log(`All ${total} syllables round-trip successfully.`);
}

module.exports = {
    syllableToStroke,
    strokeToVietnamese,
    parse,
    assemble,
};
