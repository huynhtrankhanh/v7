import {
  applyTelexTone,
  convertTelex,
  convertTelexToken,
  findTelexToneCarrier,
  stripVietnameseTone,
  TelexComposer,
} from "../src/telex";

describe("Telex core behavior", () => {
  test.each([
    ["tieengs", "tiếng"],
    ["Vieetj", "Việt"],
    ["dduwowngf", "đường"],
    ["dduowngf", "đường"],
    ["DDUOWNGF", "ĐƯỜNG"],
    ["toanf", "toàn"],
    ["toanfs", "toán"],
    ["toansz", "toan"],
  ])("%s -> %s", (raw, expected) => {
    expect(convertTelexToken(raw)).toBe(expected);
  });

  test("relocates an early tone as the composition becomes more specific", () => {
    expect(convertTelexToken("hofang")).toBe(convertTelexToken("hoangf"));
    expect(convertTelexToken("hoangf")).toBe("hoàng");
  });

  test("a later different tone replaces the earlier tone", () => {
    expect(convertTelexToken("toanfs")).toBe("toán");
  });

  test("a repeated tone key restores a literal key", () => {
    expect(convertTelexToken("ass")).toBe("as");
    expect(convertTelexToken("toanff")).toBe("toanf");
    expect(convertTelexToken("guitarr")).toBe("guitar");
  });

  test("repeated shape keys restore literal Latin input", () => {
    expect(convertTelexToken("aaa")).toBe("aa");
    expect(convertTelexToken("aww")).toBe("aw");
    expect(convertTelexToken("ddd")).toBe("dd");
  });

  test("supports the classic mixed-language repeated-mark escape", () => {
    expect(convertTelexToken("WWindowws")).toBe("Windows");
  });
});

describe("Telex vowel shapes", () => {
  test.each([
    ["aw", "ă"],
    ["aa", "â"],
    ["ee", "ê"],
    ["oo", "ô"],
    ["ow", "ơ"],
    ["uw", "ư"],
    ["uow", "ươ"],
    ["uwow", "ươ"],
    ["dd", "đ"],
  ])("%s -> %s", (raw, expected) => {
    expect(convertTelexToken(raw)).toBe(expected);
  });

  test("preserves the case of the base letter", () => {
    expect(convertTelexToken("AA")).toBe("Â");
    expect(convertTelexToken("Dd")).toBe("Đ");
    expect(convertTelexToken("dD")).toBe("đ");
    expect(convertTelexToken("W")).toBe("Ư");
  });

  test("implements the two-stage thuo + w behavior", () => {
    expect(convertTelexToken("thuow")).toBe("thuơ");
    expect(convertTelexToken("thuowr")).toBe("thuở");
    expect(convertTelexToken("thuoww")).toBe("thươ");

    expect(convertTelexToken("thuown")).toBe("thươn");
    expect(convertTelexToken("thuowng")).toBe("thương");
    expect(convertTelexToken("thuowngf")).toBe("thường");

    expect(convertTelexToken("thuowc")).toBe("thươc");
    expect(convertTelexToken("thuowcs")).toBe("thước");

    // Completion is stateful, not a generic Unicode rewrite.
    expect(convertTelexToken("uơng")).toBe("uơng");
  });

  test("does not horn the u of a qu onset when another vowel follows", () => {
    expect(convertTelexToken("quow")).toBe("quơ");
  });
});

describe("standard and simple Telex", () => {
  test("standard mode supports standalone W and bracket shortcuts", () => {
    expect(convertTelexToken("w")).toBe("ư");
    expect(convertTelexToken("W")).toBe("Ư");
    expect(convertTelexToken("t[")).toBe("tơ");
    expect(convertTelexToken("t]")).toBe("tư");
  });

  test("simple mode leaves standalone W literal", () => {
    expect(convertTelexToken("w", { mode: "simple" })).toBe("w");
    expect(convertTelexToken("W", { mode: "simple" })).toBe("W");
  });

  test("simple mode still permits W as an A/O/U modifier", () => {
    expect(convertTelexToken("dduowngf", { mode: "simple" })).toBe("đường");
  });
});

describe("free shape marks", () => {
  test("are disabled by default", () => {
    expect(convertTelexToken("duongwwfd")).not.toBe("đường");
  });

  test("permit the classic fully delayed spelling when enabled", () => {
    expect(convertTelexToken("dduongwf", { freeShapeMarks: true })).toBe(
      "đường",
    );
  });
});

describe("tone placement oracle", () => {
  test("uses the V7-derived carrier for an ordinary generated form", () => {
    const placement = findTelexToneCarrier("đương");
    expect(placement.index).not.toBeNull();
    expect(placement.source).toMatch(/^v7-broad-/);
    expect(applyTelexTone("đương", "grave")).toBe("đường");
  });

  test("keeps qu and ordinary uy behavior distinct", () => {
    expect(convertTelexToken("quys")).toBe("quý");
    expect(convertTelexToken("tuys")).toBe("túy");
  });

  test("permits malformed single-nucleus input", () => {
    const placement = findTelexToneCarrier("uoe");
    expect(placement.index).toBe(2);
    expect(placement.source).toBe("mechanical");
    expect(convertTelexToken("uoes")).toBe("uoé");
  });

  test("falls back locally to the final vowel run of a malformed token", () => {
    expect(convertTelexToken("guitar")).toBe("guitả");
    expect(convertTelexToken("abcdes")).toBe("abcdé");
  });

  test("a tone key with no preceding vowel is an ordinary letter", () => {
    expect(convertTelexToken("sa")).toBe("sa");
    expect(convertTelexToken("fa")).toBe("fa");
  });
});

describe("z tone-zero semantics", () => {
  test("clears a tone and only a tone", () => {
    expect(convertTelexToken("toansz")).toBe("toan");
    expect(convertTelexToken("aasz")).toBe("â");
    expect(convertTelexToken("aaz")).toBe("âz");
    expect(convertTelexToken("ddz")).toBe("đz");
  });

  test("a second z is literal instead of restoring the cleared tone", () => {
    expect(convertTelexToken("toanszz")).toBe("toanz");
  });
});

describe("pure helpers", () => {
  test("stripVietnameseTone preserves vowel quality", () => {
    expect(stripVietnameseTone("ấ ờ ự")).toBe("â ơ ư");
  });

  test("applyTelexTone replaces an existing tone", () => {
    expect(applyTelexTone("đường", "acute")).toBe("đướng");
  });

  test("convertTelex preserves separators", () => {
    expect(convertTelex("tieengs Vieetj!")).toBe("tiếng Việt!");
  });
});

describe("TelexComposer", () => {
  test("supports IME-style free delayed marks", () => {
    const composer = new TelexComposer({ freeShapeMarks: true });
    for (const key of "dduongwf") composer.push(key);
    expect(composer.text).toBe("đường");
  });

  test("replays raw keystrokes and backspaces over raw input", () => {
    const composer = new TelexComposer();
    for (const key of "tieengs") composer.push(key);

    expect(composer.raw).toBe("tieengs");
    expect(composer.text).toBe("tiếng");

    expect(composer.backspace()).toBe("tiêng");
    expect(composer.raw).toBe("tieeng");
  });

  test("replaceRaw, commit, and clear have explicit composition semantics", () => {
    const composer = new TelexComposer();
    expect(composer.replaceRaw("dduowngf")).toBe("đường");
    expect(composer.commit()).toBe("đường");
    expect(composer.raw).toBe("");
    expect(composer.text).toBe("");

    composer.replaceRaw("tieengs");
    composer.clear();
    expect(composer.text).toBe("");
  });

  test("push rejects multi-character input", () => {
    const composer = new TelexComposer();
    expect(() => composer.push("ab")).toThrow(TypeError);
  });
});
