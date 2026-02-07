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

// --- Helpers ---
const capitalOptions = ["", "#"];
const glideOptions = ["", "S"];
const initialOptions = ["", ...Object.keys(stenographyMap)];
const vowelOptions = Object.keys(vowelMap);
const finalOptions = ["", ...Object.keys(finalMap)];
const toneOptions = ["", ...Object.keys(toneMap)];

const initialByLength = initialOptions.slice().sort((a, b) => b.length - a.length);
const vowelByLength = vowelOptions.slice().sort((a, b) => b.length - a.length);
const finalByLength = finalOptions.slice().sort((a, b) => b.length - a.length);

const stopToneOverride = { BL: "sắc", BLG: "nặng" };
const stopFinals = { P: "p", R: "t", FR: "c", RP: "ch" };
const stopFinalFromLetter = { p: "P", t: "R", c: "FR", ch: "RP" };

function pickTone(char) {
    const info = accentToTone[char];
    if (!info) return null;
    return info;
}

// Decode stroke -> phonetic parts (without reusing original parse)
function decodeStroke(stroke) {
    let cursor = stroke;
    const capitalize = cursor.startsWith("#");
    if (capitalize) cursor = cursor.slice(1);

    const onGlide = cursor.startsWith("S");
    if (onGlide) cursor = cursor.slice(1);

    const takeToken = (pool) => {
        for (const token of pool) {
            if (cursor.startsWith(token)) {
                cursor = cursor.slice(token.length);
                return token;
            }
        }
        return null;
    };

    const initialSteno = takeToken(initialByLength);
    const vowelSteno = takeToken(vowelByLength);
    if (!vowelSteno) return null;
    const finalSteno = takeToken(finalByLength) || "";
    const toneSteno = cursor;
    if (toneSteno && !toneMap[toneSteno]) return null;
    if (toneSteno) cursor = cursor.slice(toneSteno.length);
    if (cursor !== "") return null;

    let finalConsonant = finalSteno ? finalMap[finalSteno] : "";
    let tone = toneMap[toneSteno] || "";

    if (stopToneOverride[toneSteno]) {
        const mapped = stopFinals[finalSteno];
        if (!mapped) return null;
        finalConsonant = mapped;
        tone = stopToneOverride[toneSteno];
    }

    return {
        capitalize,
        onGlide,
        initialConsonant: initialSteno ? stenographyMap[initialSteno] : "",
        vowel: vowelMap[vowelSteno],
        finalConsonant,
        tone
    };
}

function renderInitial(parsed, vowelCategory) {
    if (parsed.initialConsonant === "ng/ngh") {
        return (parsed.onGlide || vowelCategory) ? "ng" : "ngh";
    }
    if (parsed.initialConsonant === "g") {
        return (parsed.onGlide || vowelCategory) ? "g" : "gh";
    }
    if (parsed.initialConsonant === "gi") {
        return (!parsed.onGlide && (parsed.vowel === "i" || parsed.vowel === "iê/ia")) ? "g" : "gi";
    }
    if (parsed.initialConsonant === "c") {
        return parsed.onGlide ? "q" : (vowelCategory ? "c" : "k");
    }
    return parsed.initialConsonant;
}

function renderMiddle(parsed) {
    const toneChar = (base) => toneAccents[base][parsed.tone];
    const vowel = parsed.vowel;

    if (vowel === "iê/ia") {
        if (parsed.initialConsonant === "") {
            if (parsed.onGlide) {
                return parsed.finalConsonant === "" ? "uy" + toneChar("a") : "uy" + toneChar("ê");
            }
            return parsed.finalConsonant === "" ? toneChar("i") + "a" : "y" + toneChar("ê");
        }
        if (parsed.onGlide) {
            return parsed.finalConsonant === "" ? "uy" + toneChar("a") : "uy" + toneChar("ê");
        }
        return parsed.finalConsonant === "" ? toneChar("i") + "a" : "i" + toneChar("ê");
    }

    if (vowel === "ua/uô") {
        return parsed.finalConsonant === "" ? toneChar("u") + "a" : "u" + toneChar("ô");
    }
    if (vowel === "ưa/ươ") {
        return parsed.finalConsonant === "" ? toneChar("ư") + "a" : "ư" + toneChar("ơ");
    }
    if (vowel === "i") {
        if (parsed.onGlide) {
            return parsed.finalConsonant === ""
                ? (parsed.initialConsonant !== "c" ? toneChar("u") + "y" : "u" + toneChar("y"))
                : "u" + toneChar("y");
        }
        return toneChar("i");
    }
    if (vowel === "ă" && (parsed.finalConsonant === "w" || parsed.finalConsonant === "j")) {
        const prefix = parsed.onGlide ? (parsed.initialConsonant === "c" ? "u" : "o") : "";
        return prefix + toneChar("a");
    }
    if ((vowel === "â" || vowel === "ê") && parsed.onGlide) {
        return "u" + toneChar(vowel);
    }
    if (parsed.initialConsonant === "c" && parsed.onGlide) {
        return "u" + toneChar(vowel);
    }
    if (parsed.onGlide) {
        return parsed.finalConsonant === "" ? toneChar("o") + vowel : "o" + toneChar(vowel);
    }
    return toneChar(vowel);
}

function renderFinal(parsed) {
    if (parsed.finalConsonant === "w") {
        return ["iê/ia", "ư", "ưa/ươ", "ê", "u", "ă", "â", "i"].includes(parsed.vowel) ? "u" : "o";
    }
    if (parsed.finalConsonant === "j") {
        return ["ă", "â"].includes(parsed.vowel) ? "y" : "i";
    }
    return parsed.finalConsonant;
}

function renderSyllable(parsed) {
    const frontVowel = ["a", "ă", "â", "o", "ô", "ơ", "u", "ư", "ua/uô", "ưa/ươ"].includes(parsed.vowel);
    const initial = renderInitial(parsed, frontVowel);
    const middle = renderMiddle(parsed);
    const ending = renderFinal(parsed);
    const word = initial + middle + ending;
    return parsed.capitalize ? word[0].toUpperCase() + word.slice(1) : word;
}

function strokeToVietnamese(stroke) {
    const decoded = decodeStroke(stroke);
    return decoded ? renderSyllable(decoded) : null;
}

// Convert orthographic syllable to phonetic parts (text-driven, no reuse of parse/assemble)
const initialClusters = ["ngh","ng","gh","gi","qu","kh","ph","th","tr","ch","nh","đ","d","g","b","c","k","l","m","n","p","r","s","t","v","x","h","q",""] // "" for vowel-initial
    .sort((a,b)=>b.length-a.length);
const finalClusters = ["ch","nh","ng","c","m","n","p","t","y","i","u","o",""].sort((a,b)=>b.length-a.length);
const vowelOrthMap = {
    "ia": "iê/ia", "ya": "iê/ia", "iê": "iê/ia", "yê": "iê/ia",
    "ua": "ua/uô", "uô": "ua/uô",
    "ưa": "ưa/ươ", "ươ": "ưa/ươ",
    "ư": "ư", "ơ": "ơ", "ô": "ô", "o": "o", "ê": "ê", "e": "e",
    "i": "i", "a": "a", "ă": "ă", "â": "â", "u": "u", "y": "y"
};

function orthInitialToPhon(initial, vowelCore) {
    if (initial === "ng" || initial === "ngh") return "ng/ngh";
    if (initial === "q") return "c";
    if (initial === "k" || initial === "c") return "c";
    if (initial === "g" && (vowelCore.startsWith("i") || vowelCore.startsWith("e"))) return "g";
    if (initial === "gh") return "g";
    if (initial === "gi") return "gi";
    return initial;
}

function normalizeFinal(final) {
    if (final === "c") return "w";
    if (final === "ch") return "j";
    if (final === "y" || final === "i") return "j";
    if (final === "o" || final === "u") return "w";
    return final;
}

function removeAccents(syllable) {
    let tone = "";
    let plain = "";
    for (const ch of syllable) {
        const info = pickTone(ch);
        if (info) {
            tone = info.tone;
            plain += info.base;
        } else {
            plain += ch;
        }
    }
    return { tone, plain };
}

function decomposeSyllable(syllable) {
    if (!syllable) return null;
    const capitalize = syllable[0] !== syllable[0].toLowerCase();
    const lower = syllable.toLowerCase();
    const { tone, plain } = removeAccents(lower);

    for (const initial of initialClusters) {
        if (!plain.startsWith(initial)) continue;
        const afterInitial = plain.slice(initial.length);
        for (const final of finalClusters) {
            if (afterInitial.length === 0 && final) continue;
            if (final && !afterInitial.endsWith(final)) continue;
            const core = final ? afterInitial.slice(0, -final.length) : afterInitial;
            if (!core) continue;
            const vowel = vowelOrthMap[core];
            if (!vowel) continue;

            const initialConsonant = orthInitialToPhon(initial, core);
            const finalConsonant = normalizeFinal(final);

            // Try glide both ways; validated later
            return { capitalize, initialConsonant, finalConsonant, vowel, tone, onGlide: null };
        }
    }
    return null;
}

function toneToSteno(tone, finalConsonant) {
    const isStop = !!stopFinalFromLetter[finalConsonant];
    if (isStop) {
        if (tone === "sắc") return "BL";
        if (tone === "nặng") return "BLG";
        if (!tone) return "";
        return null; // hỏi/ngã/huyền invalid on stop finals
    }
    for (const [steno, label] of Object.entries(toneMap)) {
        if (steno === "BL" || steno === "BLG") continue;
        if (label === tone) return steno;
    }
    return "";
}

function initialToSteno(initialConsonant) {
    for (const [steno, val] of Object.entries(stenographyMap)) {
        if (val === initialConsonant) return steno;
    }
    return "";
}

function vowelToSteno(vowel) {
    for (const [steno, val] of Object.entries(vowelMap)) {
        if (val === vowel) return steno;
    }
    return null;
}

function finalToSteno(finalConsonant) {
    for (const [steno, val] of Object.entries(finalMap)) {
        if (val === finalConsonant) return steno;
    }
    if (stopFinalFromLetter[finalConsonant]) return stopFinalFromLetter[finalConsonant];
    if (!finalConsonant) return "";
    return null;
}

function buildStroke(parts) {
    const cap = parts.capitalize ? "#" : "";
    const glide = parts.onGlide ? "S" : "";
    const initial = initialToSteno(parts.initialConsonant);
    const vowel = vowelToSteno(parts.vowel);
    if (!vowel) return null;
    const toneSteno = toneToSteno(parts.tone, parts.finalConsonant);
    if (toneSteno === null) return null;
    const final = finalToSteno(parts.finalConsonant);
    if (final === null) return null;
    return cap + glide + initial + vowel + final + toneSteno;
}

function syllableToStroke(targetSyllable) {
    const parts = decomposeSyllable(targetSyllable);
    if (!parts || !parts.vowel) return null;
    const onGlideGuesses = [true, false];
    const cap = parts.capitalize ? "#" : "";
    for (const glideFlag of onGlideGuesses) {
        const attempt = { ...parts, onGlide: glideFlag };
        const stroke = buildStroke(attempt);
        if (!stroke) continue;
        const syllable = strokeToVietnamese(stroke);
        if (syllable === targetSyllable) return stroke;
        // try capitalization toggle if needed
        const strokeCap = buildStroke({ ...attempt, capitalize: !parts.capitalize });
        if (strokeCap && strokeToVietnamese(strokeCap) === targetSyllable) return strokeCap;
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
                            const decoded = decodeStroke(stroke);
                            if (!decoded) continue;
                            const syllable = renderSyllable(decoded);
                            total++;
                            const back = syllableToStroke(syllable);
                            if (!back) throw new Error(`No reverse stroke for syllable ${syllable}`);
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
    decodeStroke,
    renderSyllable,
};
