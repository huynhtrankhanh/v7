/** The result of decoding an Emily symbol stroke. */
export interface EmilyResult {
  type: "emily";
  value: string;
  leftSpace: boolean;
  rightSpace: boolean;
  explicitSpacing: boolean;
  capNext: boolean;
  retroSpace: "insert" | "delete" | null;
  repeat: number;
}

const EMILY_ATTACHMENT_METHOD = "space";
const EMILY_NO_SPACING_SYMBOLS = ["{*!}", "{*?}"];
const EMILY_SYMBOLS: Record<string, readonly string[]> = {
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

/** Emily capitalization uses left-hand R; star remains reserved for V7. */
export function isEmilyCapitalizationStroke(stroke: string): boolean {
  return stroke === "WHR";
}

export function isRetiredEmilyCapitalizationStroke(stroke: string): boolean {
  return stroke === "WH*";
}

/** Decode an Emily symbol chord, including compositional left-R capitalization. */
export function handleEmilySymbol(stroke: string): EmilyResult | null {
  // R immediately after the WH starter is the capitalization modifier. A
  // right-hand R pattern follows the hyphen instead (for example, WH-R).
  const match = stroke.match(
    /^([#]?WH)(R?)([AO]*)(-?)([EU]*)(-?)([FRPBLG]*)([TS]*)$/,
  );
  if (!match) return null;
  const [
    ,
    ,
    capitalizationKey,
    attachments,
    separatorBeforeVariant,
    variantKeys,
    separatorBeforePattern,
    pattern,
    repeatKeys,
  ] = match;

  // A canonical steno outline contains at most one explicit side separator.
  if (separatorBeforeVariant && separatorBeforePattern) return null;

  if (!(pattern in EMILY_SYMBOLS)) return null;

  let variant = 0;
  if (variantKeys.includes("E")) variant += 1;
  if (variantKeys.includes("U")) variant += 2;
  const symbol = EMILY_SYMBOLS[pattern][variant];

  let repeat = 1;
  if (repeatKeys.includes("S")) repeat += 1;
  if (repeatKeys.includes("T")) repeat += 2;

  const spaceBefore =
    EMILY_ATTACHMENT_METHOD === "space"
      ? attachments.includes("A")
      : !attachments.includes("A");
  const spaceAfter =
    EMILY_ATTACHMENT_METHOD === "space"
      ? attachments.includes("O")
      : !attachments.includes("O");
  const shouldApplySpacing = !EMILY_NO_SPACING_SYMBOLS.includes(symbol);

  return {
    type: "emily",
    value: symbol.repeat(repeat),
    leftSpace: shouldApplySpacing ? spaceBefore : false,
    rightSpace: shouldApplySpacing ? spaceAfter : false,
    explicitSpacing: shouldApplySpacing,
    capNext: capitalizationKey === "R",
    retroSpace:
      symbol === "{*?}" ? "insert" : symbol === "{*!}" ? "delete" : null,
    repeat,
  };
}
