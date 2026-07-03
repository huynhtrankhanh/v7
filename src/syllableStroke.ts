export type ParsedSyllable = {
  capitalize: boolean;
  onGlide: boolean;
  initialConsonant: string;
  vowel: string;
  finalConsonant: string;
  tone: string;
};

export const stenographyMap: Record<string, string> = {
  PW: "b", K: "c", KH: "ch", KWR: "d", TK: "đ", TP: "ph",
  TKPW: "g", H: "h", KWH: "gi", KHR: "kh", HR: "l", PH: "m",
  TPH: "n", TPR: "nh", TPW: "ng/ngh", P: "p", R: "r", KP: "s",
  T: "t", TH: "th", TR: "tr", W: "v", WR: "x"
};

export const vowelMap: Record<string, string> = {
  OEU: "iê/ia", AEU: "ua/uô", AOE: "ưa/ươ", AOU: "ư", OU: "ơ",
  OE: "ô", O: "o", AU: "ê", E: "e", EU: "i", A: "a",
  AE: "ă", AO: "â", U: "u", AOEU: "y"
};

export const finalMap: Record<string, string> = {
  FP: "j", F: "w", P: "m", R: "n", FR: "ng", RP: "nh"
};

export const toneMap: Record<string, string> = {
  L: "sắc", G: "huyền", B: "hỏi", LG: "ngã", BG: "nặng",
  BL: "ách", BLG: "ạch"
};

const toneAccents: Record<string, Record<string, string>> = {
  a: { "": "a", sắc: "á", huyền: "à", hỏi: "ả", ngã: "ã", nặng: "ạ" },
  ă: { "": "ă", sắc: "ắ", huyền: "ằ", hỏi: "ẳ", ngã: "ẵ", nặng: "ặ" },
  â: { "": "â", sắc: "ấ", huyền: "ầ", hỏi: "ẩ", ngã: "ẫ", nặng: "ậ" },
  e: { "": "e", sắc: "é", huyền: "è", hỏi: "ẻ", ngã: "ẽ", nặng: "ẹ" },
  ê: { "": "ê", sắc: "ế", huyền: "ề", hỏi: "ể", ngã: "ễ", nặng: "ệ" },
  i: { "": "i", sắc: "í", huyền: "ì", hỏi: "ỉ", ngã: "ĩ", nặng: "ị" },
  o: { "": "o", sắc: "ó", huyền: "ò", hỏi: "ỏ", ngã: "õ", nặng: "ọ" },
  ô: { "": "ô", sắc: "ố", huyền: "ồ", hỏi: "ổ", ngã: "ỗ", nặng: "ộ" },
  ơ: { "": "ơ", sắc: "ớ", huyền: "ờ", hỏi: "ở", ngã: "ỡ", nặng: "ợ" },
  u: { "": "u", sắc: "ú", huyền: "ù", hỏi: "ủ", ngã: "ũ", nặng: "ụ" },
  ư: { "": "ư", sắc: "ứ", huyền: "ừ", hỏi: "ử", ngã: "ữ", nặng: "ự" },
  y: { "": "y", sắc: "ý", huyền: "ỳ", hỏi: "ỷ", ngã: "ỹ", nặng: "ỵ" }
};

export function parseSyllableStroke(stroke: string): ParsedSyllable | null {
  let currentStroke = stroke;
  let capitalize = false;
  if (currentStroke.startsWith("#")) {
    capitalize = true;
    currentStroke = currentStroke.substring(1);
  }

  const onGlide = currentStroke.startsWith("S");
  if (onGlide) currentStroke = currentStroke.substring(1);

  let initialConsonant = "";
  for (let length = 4; length > 0; length--) {
    if (length > currentStroke.length) continue;
    const candidate = currentStroke.substring(0, length);
    if (stenographyMap[candidate] !== undefined) {
      initialConsonant = stenographyMap[candidate];
      currentStroke = currentStroke.substring(length);
      break;
    }
  }

  let vowel = "";
  let survived = false;
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
  for (let length = 2; length > 0; length--) {
    if (length > currentStroke.length) continue;
    const candidate = currentStroke.substring(0, length);
    if (finalMap[candidate] !== undefined) {
      finalConsonant = finalMap[candidate];
      finalSteno = candidate;
      currentStroke = currentStroke.substring(length);
      break;
    }
  }

  let tone = "";
  let toneSteno = "";
  survived = currentStroke.length === 0;
  if (currentStroke.length > 0 && toneMap[currentStroke] !== undefined) {
    tone = toneMap[currentStroke];
    toneSteno = currentStroke;
    currentStroke = "";
    survived = true;
  }
  if (!survived) return null;

  if (toneSteno === "BL" || toneSteno === "BLG") {
    const stopFinals: Record<string, string> = { P: "p", R: "t", FR: "c", RP: "ch" };
    if (!stopFinals[finalSteno]) return null;
    finalConsonant = stopFinals[finalSteno];
    tone = toneSteno === "BL" ? "sắc" : "nặng";
  }

  return { capitalize, onGlide, initialConsonant, vowel, finalConsonant, tone };
}

export function assembleSyllable(parsed: ParsedSyllable): string {
  const initial = () => {
    const front = ["a", "ă", "â", "o", "ô", "ơ", "u", "ư", "ua/uô", "ưa/ươ"].includes(parsed.vowel);
    if (parsed.initialConsonant === "ng/ngh") return parsed.onGlide || front ? "ng" : "ngh";
    if (parsed.initialConsonant === "g") return parsed.onGlide || front ? "g" : "gh";
    if (parsed.initialConsonant === "gi") {
      return !parsed.onGlide && (parsed.vowel === "i" || parsed.vowel === "iê/ia") ? "g" : "gi";
    }
    if (parsed.initialConsonant === "c") return parsed.onGlide ? "q" : front ? "c" : "k";
    return parsed.initialConsonant;
  };

  const middle = () => {
    if (parsed.vowel === "iê/ia") {
      if (parsed.initialConsonant === "") {
        if (parsed.onGlide) return parsed.finalConsonant === "" ? "uy" + toneAccents.a[parsed.tone] : "uy" + toneAccents.ê[parsed.tone];
        return parsed.finalConsonant === "" ? toneAccents.i[parsed.tone] + "a" : "y" + toneAccents.ê[parsed.tone];
      }
      if (parsed.onGlide) return parsed.finalConsonant === "" ? "uy" + toneAccents.a[parsed.tone] : "uy" + toneAccents.ê[parsed.tone];
      return parsed.finalConsonant === "" ? toneAccents.i[parsed.tone] + "a" : "i" + toneAccents.ê[parsed.tone];
    }
    if (parsed.vowel === "ua/uô") {
      return parsed.finalConsonant === "" ? toneAccents.u[parsed.tone] + "a" : "u" + toneAccents.ô[parsed.tone];
    }
    if (parsed.vowel === "ưa/ươ") {
      return parsed.finalConsonant === "" ? toneAccents.ư[parsed.tone] + "a" : "ư" + toneAccents.ơ[parsed.tone];
    }
    if (parsed.vowel === "i") {
      if (parsed.onGlide) {
        if (parsed.finalConsonant === "") {
          return parsed.initialConsonant !== "c" ? toneAccents.u[parsed.tone] + "y" : "u" + toneAccents.y[parsed.tone];
        }
        return "u" + toneAccents.y[parsed.tone];
      }
      return toneAccents.i[parsed.tone];
    }
    if (parsed.vowel === "ă" && ["w", "j"].includes(parsed.finalConsonant)) {
      const prefix = parsed.onGlide ? (parsed.initialConsonant === "c" ? "u" : "o") : "";
      return prefix + toneAccents.a[parsed.tone];
    }
    if (["â", "ê"].includes(parsed.vowel) && parsed.onGlide) return "u" + toneAccents[parsed.vowel][parsed.tone];
    if (parsed.initialConsonant === "c" && parsed.onGlide) return "u" + toneAccents[parsed.vowel][parsed.tone];
    if (parsed.onGlide) {
      return parsed.finalConsonant === "" ? toneAccents.o[parsed.tone] + parsed.vowel : "o" + toneAccents[parsed.vowel][parsed.tone];
    }
    return toneAccents[parsed.vowel][parsed.tone];
  };

  const final = () => {
    if (parsed.finalConsonant === "w") {
      return ["iê/ia", "ư", "ưa/ươ", "ê", "u", "ă", "â", "i"].includes(parsed.vowel) ? "u" : "o";
    }
    if (parsed.finalConsonant === "j") return ["ă", "â"].includes(parsed.vowel) ? "y" : "i";
    return parsed.finalConsonant;
  };

  const text = initial() + middle() + final();
  return parsed.capitalize ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
