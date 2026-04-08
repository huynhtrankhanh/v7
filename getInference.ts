type InferencePosition =
  | { type: "fixed text"; text: string }
  | { type: "syllable"; candidates: string[] };

type PartialSyllableTemplate = {
  consonant: string;
  rimeFirstLetter: string;
  tone: number;
};

type Tokenizer = {
  validConsonantsMap: Map<string, string>;
  sortedConsonantKeys: string[];
  candidatesIndex: Map<string, string[]>;
};

function structuredOnset(c: string, v: string): string {
  if (c === "0") return "";
  if (c === "w") return "qu";
  if (c === "g" && (v === "e" || v === "i")) return "gh";
  if (c === "ng" && (v === "e" || v === "i")) return "ngh";
  if (c === "k" && (v === "e" || v === "i")) return "k";
  if (c === "k") return "c";
  return c;
}

function enumerateRegex(regex: string): string[] {
  const chars = [...regex];
  let idx = 0;

  const appendCartesian = (base: string[], values: string[]): string[] => {
    const next: string[] = [];
    for (const b of base) {
      for (const v of values) {
        next.push(`${b}${v}`);
      }
    }
    return next;
  };

  const appendOptional = (base: string[], values: string[]): string[] => {
    const next: string[] = [];
    for (const b of base) {
      for (const v of values) next.push(`${b}${v}`);
      next.push(b);
    }
    return next;
  };

  const expandExpr = (): string[] => {
    const alternatives: string[][] = [];
    let current = [""];

    while (idx < chars.length) {
      const c = chars[idx];
      if (c === ")") break;

      if (c === "(") {
        idx += 1;
        if (chars[idx] === "?") {
          idx += 1;
          if (chars[idx] === ":") idx += 1;
        }
        const nested = expandExpr();
        if (chars[idx] === ")") idx += 1;

        if (chars[idx] === "?") {
          idx += 1;
          current = appendOptional(current, nested);
        } else {
          current = appendCartesian(current, nested);
        }
        continue;
      }

      if (c === "[") {
        idx += 1;
        const classChars: string[] = [];
        while (idx < chars.length && chars[idx] !== "]") {
          classChars.push(chars[idx]);
          idx += 1;
        }
        if (chars[idx] === "]") idx += 1;

        if (chars[idx] === "?") {
          idx += 1;
          current = appendOptional(current, classChars);
        } else {
          current = appendCartesian(current, classChars);
        }
        continue;
      }

      if (c === "|") {
        alternatives.push(current);
        current = [""];
        idx += 1;
        continue;
      }

      if (c === "\\") {
        idx += 1;
        if (idx >= chars.length) break;
        const escaped = chars[idx];
        idx += 1;

        if (chars[idx] === "?") {
          idx += 1;
          current = appendOptional(current, [escaped]);
        } else {
          current = current.map((s) => `${s}${escaped}`);
        }
        continue;
      }

      idx += 1;
      if (chars[idx] === "?") {
        idx += 1;
        current = appendOptional(current, [c]);
      } else {
        current = current.map((s) => `${s}${c}`);
      }
    }

    alternatives.push(current);
    return alternatives.flat();
  };

  return expandExpr();
}

function generateStructuredRegexMap(): Map<string, string> {
  const map = new Map<string, string>();
  const structuredConsonants = [
    "0", "b", "ch", "d", "g", "h", "k", "kh", "l", "m", "n", "ng", "nh", "p", "ph", "r",
    "s", "t", "th", "tr", "v", "w", "x", "z", "đ",
  ];
  const structuredHardConsonants = new Set(["b", "ch", "d", "g", "kh", "ng", "p", "ph", "r", "tr", "x", "đ"]);

  const a = ["(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)","(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)","(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)","(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)","(?:[ấắ][cpt]|á(?:ch?|[pt]))","(?:[ậặ][cpt]|ạ(?:ch?|[pt]))"];
  const e = ["(?:e(?:(?:ng?|[mo]))?|ê(?:(?:nh?|[mu]))?)","(?:é(?:(?:ng?|[mo]))?|ế(?:(?:nh?|[mu]))?)","(?:è(?:(?:ng?|[mo]))?|ề(?:(?:nh?|[mu]))?)","(?:ẻ(?:(?:ng?|[mo]))?|ể(?:(?:nh?|[mu]))?)","(?:ẽ(?:(?:ng?|[mo]))?|ễ(?:(?:nh?|[mu]))?)","(?:ẹ(?:(?:ng?|[mo]))?|ệ(?:(?:nh?|[mu]))?)","(?:é[cpt]|ế(?:ch|[pt]))","(?:ẹ[cpt]|ệ(?:ch|[pt]))"];
  const o = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]|ă(?:m|ng?)|e(?:[no])?|a(?:(?:[imouy]|n(?:[gh])?))?))?)","(?:ớ(?:[imn])?|ố(?:(?:ng?|[im]))?|ó(?:(?:ng?|[aeim]))?|o(?:óng|é[no]|ắ(?:m|ng?)|á(?:[imouy]|n(?:[gh])?)))","(?:ờ(?:[imn])?|ồ(?:(?:ng?|[im]))?|ò(?:(?:ng?|[aeim]))?|o(?:òng|è[no]|ằ(?:m|ng?)|à(?:[imouy]|n(?:[gh])?)))","(?:ở(?:[imn])?|ổ(?:(?:ng?|[im]))?|ỏ(?:(?:ng?|[aeim]))?|o(?:ỏng|ẻ[no]|ẳ(?:m|ng?)|ả(?:[imouy]|n(?:[gh])?)))","(?:ỡ(?:[imn])?|ỗ(?:(?:ng?|[im]))?|õ(?:(?:ng?|[aeim]))?|o(?:õng|ẽ[no]|ẵ(?:m|ng?)|ã(?:[imouy]|n(?:[gh])?)))","(?:ợ(?:[imn])?|ộ(?:(?:ng?|[im]))?|ọ(?:(?:ng?|[aeim]))?|o(?:ọng|ẹ[no]|ặ(?:m|ng?)|ạ(?:[imouy]|n(?:[gh])?)))","(?:ớ[pt]|[óố][cpt]|o(?:ét|óc|ắ[cpt]|á(?:ch?|[pt])))","(?:ợ[pt]|[ọộ][cpt]|o(?:ẹt|ọc|ặ[cpt]|ạ(?:ch?|[pt])))"];
  const u = ["(?:ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?|u(?:(?:ng?|[aim]|ê(?:nh?)?|â(?:y|ng?)|ơ(?:[in])?|ô(?:ng?|[im])|y(?:(?:ên|nh?|[amu]))?))?)","(?:ướ(?:ng?|[imu])|ú(?:(?:ng?|[aimy]))?|ứ(?:(?:ng?|[aimu]))?|u(?:yến|ế(?:nh?)?|ấ(?:y|ng?)|ớ(?:[in])?|ố(?:ng?|[im])|ý(?:nh?|[amu])))","(?:ườ(?:ng?|[imu])|ù(?:(?:ng?|[aimy]))?|ừ(?:(?:ng?|[aimu]))?|u(?:yền|ề(?:nh?)?|ầ(?:y|ng?)|ờ(?:[in])?|ồ(?:ng?|[im])|ỳ(?:nh?|[amu])))","(?:ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aimy]))?|ử(?:(?:ng?|[aimu]))?|u(?:yển|ể(?:nh?)?|ẩ(?:y|ng?)|ở(?:[in])?|ổ(?:ng?|[im])|ỷ(?:nh?|[amu])))","(?:ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aimy]))?|ữ(?:(?:ng?|[aimu]))?|u(?:yễn|ễ(?:nh?)?|ẫ(?:y|ng?)|ỡ(?:[in])?|ỗ(?:ng?|[im])|ỹ(?:nh?|[amu])))","(?:ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aimy]))?|ự(?:(?:ng?|[aimu]))?|u(?:yện|ệ(?:nh?)?|ậ(?:y|ng?)|ợ(?:[in])?|ộ(?:ng?|[im])|ỵ(?:nh?|[amu])))","(?:ướ[cpt]|[úứ][cpt]|u(?:ớt|yết|ấ[ct]|ố[cpt]|ế(?:t|ch)|ý(?:ch|[pt])))","(?:ượ[cpt]|[ụự][cpt]|u(?:ợt|yệt|ậ[ct]|ộ[cpt]|ệ(?:t|ch)|ỵ(?:ch|[pt])))"];
  const iz = ["(?:i(?:(?:nh?|[amu]))?|y(?:ê(?:ng?|[mu]))?)","(?:ý|yế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:ỳ|yề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:ỷ|yể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:ỹ|yễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:ỵ|yệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:yế[cpt]|í(?:ch|[pt]))","(?:yệ[cpt]|ị(?:ch|[pt]))"];
  const isz = ["(?:y|i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?)","(?:ý|iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:ỳ|iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:ỷ|iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:ỹ|iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:ỵ|iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:iế[cpt]|í(?:ch|[pt]))","(?:iệ[cpt]|ị(?:ch|[pt]))"];
  const ih = ["i(?:(?:nh?|[amu]|ê(?:ng?|[mu])))?","(?:iế(?:ng?|[mu])|í(?:(?:nh?|[amu]))?)","(?:iề(?:ng?|[mu])|ì(?:(?:nh?|[amu]))?)","(?:iể(?:ng?|[mu])|ỉ(?:(?:nh?|[amu]))?)","(?:iễ(?:ng?|[mu])|ĩ(?:(?:nh?|[amu]))?)","(?:iệ(?:ng?|[mu])|ị(?:(?:nh?|[amu]))?)","(?:iế[cpt]|í(?:ch|[pt]))","(?:iệ[cpt]|ị(?:ch|[pt]))"];
  const wa = ["(?:ă(?:m|ng?)|â(?:y|ng?)|a(?:(?:[imouy]|n(?:[gh])?))?)","(?:ắ(?:m|ng?)|ấ(?:y|ng?)|á(?:(?:[imouy]|n(?:[gh])?))?)","(?:ằ(?:m|ng?)|ầ(?:y|ng?)|à(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẳ(?:m|ng?)|ẩ(?:y|ng?)|ả(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẵ(?:m|ng?)|ẫ(?:y|ng?)|ã(?:(?:[imouy]|n(?:[gh])?))?)","(?:ặ(?:m|ng?)|ậ(?:y|ng?)|ạ(?:(?:[imouy]|n(?:[gh])?))?)","(?:ấ[ct]|ắ[cpt]|á(?:ch?|[pt]))","(?:ậ[ct]|ặ[cpt]|ạ(?:ch?|[pt]))"];
  const we = ["(?:ê(?:nh?)?|e(?:[no])?)","(?:ế(?:nh?)?|é(?:[no])?)","(?:ề(?:nh?)?|è(?:[no])?)","(?:ể(?:nh?)?|ẻ(?:[no])?)","(?:ễ(?:nh?)?|ẽ(?:[no])?)","(?:ệ(?:nh?)?|ẹ(?:[no])?)","(?:ét|ế(?:t|ch))","(?:ẹt|ệ(?:t|ch))"];
  const wi = ["y(?:(?:ên|nh?|[amu]))?","(?:yến|ý(?:(?:nh?|[amu]))?)","(?:yền|ỳ(?:(?:nh?|[amu]))?)","(?:yển|ỷ(?:(?:nh?|[amu]))?)","(?:yễn|ỹ(?:(?:nh?|[amu]))?)","(?:yện|ỵ(?:(?:nh?|[amu]))?)","(?:yết|ý(?:ch|[pt]))","(?:yệt|ỵ(?:ch|[pt]))"];
  const wo = ["(?:ông|ơ(?:[in])?)","(?:ống|ớ(?:[in])?)","(?:ồng|ờ(?:[in])?)","(?:ổng|ở(?:[in])?)","(?:ỗng|ỡ(?:[in])?)","(?:ộng|ợ(?:[in])?)","(?:ốc|ớt)","(?:ộc|ợt)"];
  const ko = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)","(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)","(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)","(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)","(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)","(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)","(?:oóc|ớ[pt]|[óố][cpt])","(?:oọc|ợ[pt]|[ọộ][cpt])"];
  const ku = ["(?:u(?:(?:ng?|[aim]|ô(?:ng?|[im])))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)","(?:uố(?:ng?|[im])|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)","(?:uồ(?:ng?|[im])|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)","(?:uổ(?:ng?|[im])|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)","(?:uỗ(?:ng?|[im])|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)","(?:uộ(?:ng?|[im])|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)","(?:uố[cpt]|ướ[cpt]|[úứ][cpt])","(?:uộ[cpt]|ượ[cpt]|[ụự][cpt])"];
  const za = ["(?:ă(?:m|ng?)|â(?:ng?|[muy])|a(?:(?:[imouy]|n(?:[gh])?))?)","(?:ắ(?:m|ng?)|ấ(?:ng?|[muy])|á(?:(?:[imouy]|n(?:[gh])?))?)","(?:ằ(?:m|ng?)|ầ(?:ng?|[muy])|à(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẳ(?:m|ng?)|ẩ(?:ng?|[muy])|ả(?:(?:[imouy]|n(?:[gh])?))?)","(?:ẵ(?:m|ng?)|ẫ(?:ng?|[muy])|ã(?:(?:[imouy]|n(?:[gh])?))?)","(?:ặ(?:m|ng?)|ậ(?:ng?|[muy])|ạ(?:(?:[imouy]|n(?:[gh])?))?)","(?:[ấắ][cpt]|á(?:ch?|[pt]))","(?:[ậặ][cpt]|ạ(?:ch?|[pt]))"];
  const ze = ["e(?:(?:ng?|[mo]))?","é(?:(?:ng?|[mo]))?","è(?:(?:ng?|[mo]))?","ẻ(?:(?:ng?|[mo]))?","ẽ(?:(?:ng?|[mo]))?","ẹ(?:(?:ng?|[mo]))?","é[cpt]","ẹ[cpt]"];
  const zo = ["(?:ơ(?:[imn])?|ô(?:(?:ng?|[im]))?|o(?:(?:ng?|ong|[im]))?)","(?:oóng|ớ(?:[imn])?|[óố](?:(?:ng?|[im]))?)","(?:oòng|ờ(?:[imn])?|[òồ](?:(?:ng?|[im]))?)","(?:oỏng|ở(?:[imn])?|[ỏổ](?:(?:ng?|[im]))?)","(?:oõng|ỡ(?:[imn])?|[õỗ](?:(?:ng?|[im]))?)","(?:oọng|ợ(?:[imn])?|[ọộ](?:(?:ng?|[im]))?)","(?:oóc|ớ[pt]|[óố][cpt])","(?:oọc|ợ[pt]|[ọộ][cpt])"];
  const zu = ["(?:u(?:(?:ng?|[aim]|ô(?:i|ng)))?|ư(?:(?:ng?|[aimu]|ơ(?:ng?|[imu])))?)","(?:uố(?:i|ng)|ướ(?:ng?|[imu])|ú(?:(?:ng?|[aim]))?|ứ(?:(?:ng?|[aimu]))?)","(?:uồ(?:i|ng)|ườ(?:ng?|[imu])|ù(?:(?:ng?|[aim]))?|ừ(?:(?:ng?|[aimu]))?)","(?:uổ(?:i|ng)|ưở(?:ng?|[imu])|ủ(?:(?:ng?|[aim]))?|ử(?:(?:ng?|[aimu]))?)","(?:uỗ(?:i|ng)|ưỡ(?:ng?|[imu])|ũ(?:(?:ng?|[aim]))?|ữ(?:(?:ng?|[aimu]))?)","(?:uộ(?:i|ng)|ượ(?:ng?|[imu])|ụ(?:(?:ng?|[aim]))?|ự(?:(?:ng?|[aimu]))?)","(?:uốc|ướ[cpt]|[úứ][cpt])","(?:uộc|ượ[cpt]|[ụự][cpt])"];
  const zi = ["g(?:i(?:[mn])?|iê(?:[mnu]|ng|nh)?)","g(?:í(?:[mn])?|iế(?:[mnu]|ng|nh)?)","g(?:ì(?:[mn])?|iề(?:[mnu]|ng|nh)?)","g(?:ỉ(?:[mn])?|iể(?:[mnu]|ng|nh)?)","g(?:ĩ(?:[mn])?|iễ(?:[mnu]|ng|nh)?)","g(?:ị(?:[mn])?|iệ(?:[mnu]|ng|nh)?)","g(?:í[pt]|iế(?:[cpt]|ch))","g(?:ị[pt]|iệ(?:[cpt]|ch))"];

  for (const c of structuredConsonants) {
    for (const v of ["a", "e", "i", "o", "u"] as const) {
      if (c === "w" && v === "u") continue;
      for (let i = 0; i < 8; i++) {
        const k = `${c}_${v}_${i}`;

        if (c === "w") {
          const s = v === "a" ? wa[i] : v === "e" ? we[i] : v === "i" ? wi[i] : wo[i];
          map.set(k, `qu${s}`);
          continue;
        }

        if (c === "z") {
          if (v === "i") {
            map.set(k, zi[i]);
          } else {
            const s = v === "a" ? za[i] : v === "e" ? ze[i] : v === "o" ? zo[i] : zu[i];
            map.set(k, `gi${s}`);
          }
          continue;
        }

        if (v === "i") {
          const iValue = c === "0" ? iz[i] : structuredHardConsonants.has(c) ? ih[i] : isz[i];
          map.set(k, `${structuredOnset(c, v)}${iValue}`);
          continue;
        }

        let s = v === "a" ? a[i] : v === "e" ? e[i] : v === "o" ? o[i] : u[i];
        if (c === "k" && v === "o") s = ko[i];
        if (c === "k" && v === "u") s = ku[i];
        map.set(k, `${structuredOnset(c, v)}${s}`);
      }
    }
  }

  return map;
}

function createTokenizer(): Tokenizer {
  const regexMap = generateStructuredRegexMap();
  const validConsonantsMap = new Map<string, string>();
  const candidatesIndex = new Map<string, string[]>();

  for (const [key, regex] of regexMap.entries()) {
    const c = key.split("_")[0];
    validConsonantsMap.set(c, c);
    candidatesIndex.set(key, enumerateRegex(regex));
  }

  validConsonantsMap.set("dd", "đ");

  const sortedConsonantKeys = [...validConsonantsMap.keys()].sort((a, b) => b.length - a.length);
  return { validConsonantsMap, sortedConsonantKeys, candidatesIndex };
}

const TOKENIZER = createTokenizer();

function parseV7String(v7String: string, tokenizer: Tokenizer): PartialSyllableTemplate[] {
  const templates: PartialSyllableTemplate[] = [];
  let currentSlice = v7String;

  while (currentSlice.length > 0) {
    let matchedKey: string | undefined;
    for (const key of tokenizer.sortedConsonantKeys) {
      if (currentSlice.startsWith(key)) {
        matchedKey = key;
        break;
      }
    }

    if (!matchedKey) {
      throw new Error(`Could not parse consonant at: ${currentSlice}`);
    }

    const consonant = tokenizer.validConsonantsMap.get(matchedKey);
    if (!consonant) {
      throw new Error(`Unknown consonant key: ${matchedKey}`);
    }
    currentSlice = currentSlice.slice(matchedKey.length);

    const rimeStart = currentSlice[0];
    const toneChar = currentSlice[1];
    if (!rimeStart || !toneChar) {
      throw new Error(`Unexpected end while parsing: ${v7String}`);
    }

    const tone = Number.parseInt(toneChar, 10);
    if (!Number.isInteger(tone) || tone < 0 || tone > 7) {
      throw new Error(`Expected digit tone, got: ${toneChar}`);
    }

    currentSlice = currentSlice.slice(2);
    templates.push({ consonant, rimeFirstLetter: rimeStart, tone });
  }

  return templates;
}

function getTemplateCandidates(template: PartialSyllableTemplate, tokenizer: Tokenizer): string[] {
  const key = `${template.consonant}_${template.rimeFirstLetter}_${template.tone}`;
  return tokenizer.candidatesIndex.get(key) ?? [];
}

export function getInference(rawInput: string[]): InferencePosition[] {
  if (!Array.isArray(rawInput) || !rawInput.every((value) => typeof value === "string")) {
    throw new TypeError("rawInput must be a string array.");
  }

  const result: InferencePosition[] = [];

  for (let i = 0; i < rawInput.length; i++) {
    const chunk = rawInput[i];

    if (i % 2 === 0) {
      result.push({ type: "fixed text", text: chunk });
      continue;
    }

    try {
      const templates = parseV7String(chunk, TOKENIZER);
      for (const template of templates) {
        result.push({ type: "syllable", candidates: getTemplateCandidates(template, TOKENIZER) });
      }
    } catch {
      result.push({ type: "syllable", candidates: [] });
    }
  }

  return result;
}
