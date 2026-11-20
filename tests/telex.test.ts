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
    ["dduongwf", "đường"],
    ["duongwfd", "đường"],
    ["vietej", "việt"],
    ["namw", "năm"],
    ["gieengs", "giếng"],
    ["giengs", "giéng"],
    ["toanf", "toàn"],
    ["toanfs", "toán"],
    ["toansz", "toan"],
  ])("%s -> %s", (raw, expected) => {
    expect(convertTelexToken(raw)).toBe(expected);
  });

  test("relocates an early tone as the composition becomes more specific", () => {
    expect(convertTelexToken("hofang")).toBe(convertTelexToken("hoangf"));
    expect(convertTelexToken("hoangf")).toBe("hoàng");
    expect(convertTelexToken("hoaf")).toBe("hòa");
    expect(convertTelexToken("hoafng")).toBe("hoàng");
  });

  test("a later different tone replaces the earlier tone", () => {
    expect(convertTelexToken("toanfs")).toBe("toán");
    expect(convertTelexToken("toansf")).toBe("toàn");
  });

  test("repeated tone and shape keys restore literal input", () => {
    expect(convertTelexToken("ass")).toBe("as");
    expect(convertTelexToken("asss")).toBe("ass");
    expect(convertTelexToken("toanff")).toBe("toanf");
    expect(convertTelexToken("aaa")).toBe("aa");
    expect(convertTelexToken("aaaaa")).toBe("aaaa");
    expect(convertTelexToken("aww")).toBe("aw");
    expect(convertTelexToken("ddd")).toBe("dd");
    expect(convertTelexToken("ddddd")).toBe("ddd");
    expect(convertTelexToken("ww")).toBe("w");
    expect(convertTelexToken("wwwww")).toBe("wwww");
  });

  test("auto-restores non-Vietnamese and English words on word breaks", () => {
    expect(convertTelex("windows ")).toBe("windows ");
    expect(convertTelex("Windows ")).toBe("Windows ");
    expect(convertTelex("server ")).toBe("server ");
    expect(convertTelex("system ")).toBe("system ");
    expect(convertTelex("cases ")).toBe("cases ");
    expect(convertTelex("world. ")).toBe("world. ");
    expect(convertTelex("water ")).toBe("water ");
    expect(convertTelex("software ")).toBe("software ");
    expect(convertTelex("browser ")).toBe("browser ");
    expect(convertTelex("android ")).toBe("android ");
    expect(convertTelexToken("add")).toBe("add");
    expect(convertTelexToken("address")).toBe("address");
    expect(convertTelexToken("middle")).toBe("middle");
    expect(convertTelexToken("padding")).toBe("padding");
    expect(convertTelexToken("reddit")).toBe("reddit");
    expect(convertTelex("guitar ")).toBe("guitar ");
    expect(convertTelex("guitarr ")).toBe("guitarr ");
    expect(convertTelex("Windows vaaf Linux ddeeuf hoox trowj Android. ")).toBe(
      "Windows vầ Linux đều hỗ trợ Android. ",
    );
    expect(convertTelex("tieengs1 ")).toBe("tieengs1 ");
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
    ["aaw", "ă"],
    ["awa", "â"],
    ["oow", "ơ"],
    ["owo", "ô"],
    ["uowo", "uô"],
    ["uoow", "ươ"],
    ["muaw", "mưa"],
    ["luuw", "lưu"],
    ["ruoujw", "rượu"],
    ["ruowuj", "rượu"],
  ])("%s -> %s", (raw, expected) => {
    expect(convertTelexToken(raw)).toBe(expected);
  });

  test("preserves the case of the base letter", () => {
    expect(convertTelexToken("AA")).toBe("Â");
    expect(convertTelexToken("Dd")).toBe("Đ");
    expect(convertTelexToken("dD")).toBe("đ");
    expect(convertTelexToken("W")).toBe("Ư");
    expect(convertTelexToken("WW")).toBe("W");
    expect(convertTelexToken("Ww")).toBe("Uw");
    expect(convertTelexToken("wW")).toBe("uW");
    expect(convertTelex("Dd ")).toBe("Đ ");
    expect(convertTelex("dD ")).toBe("đ ");
  });

  test("implements UniKey two-stage thuo + w while horning huow and khuow immediately", () => {
    expect(convertTelexToken("thuow")).toBe("thuơ");
    expect(convertTelexToken("thuowr")).toBe("thuở");
    expect(convertTelexToken("thuoww")).toBe("thươ");

    expect(convertTelexToken("thuown")).toBe("thươn");
    expect(convertTelexToken("thuowng")).toBe("thương");
    expect(convertTelexToken("thuowngf")).toBe("thường");

    expect(convertTelexToken("thuowc")).toBe("thươc");
    expect(convertTelexToken("thuowcs")).toBe("thước");

    expect(convertTelexToken("huow")).toBe("hươ");
    expect(convertTelexToken("huowr")).toBe("hưở");
    expect(convertTelexToken("khuow")).toBe("khươ");
    expect(convertTelexToken("khuowr")).toBe("khưở");
  });

  test("does not horn the u of a qu onset when another vowel follows", () => {
    expect(convertTelexToken("quow")).toBe("quơ");
    expect(convertTelexToken("quaw")).toBe("quă");
  });
});

describe("standard and simple Telex", () => {
  test("standard mode supports standalone W and bracket shortcuts including uppercase", () => {
    expect(convertTelexToken("w")).toBe("ư");
    expect(convertTelexToken("W")).toBe("Ư");
    expect(convertTelexToken("t[")).toBe("tơ");
    expect(convertTelexToken("t]")).toBe("tư");
    expect(convertTelexToken("t{")).toBe("tƠ");
    expect(convertTelexToken("t}")).toBe("tƯ");
    expect(convertTelex("t[[ ")).toBe("t[ ");
    expect(convertTelex("t{{ ")).toBe("t{ ");
    expect(convertTelex("[[ ")).toBe("[ ");
    expect(convertTelex("{{ ")).toBe("{ ");
    expect(convertTelex("[] ")).toBe("ơ] ");
  });

  test("simple mode leaves standalone W and brackets literal", () => {
    expect(convertTelexToken("w", { mode: "simple" })).toBe("w");
    expect(convertTelexToken("W", { mode: "simple" })).toBe("W");
    expect(convertTelexToken("t[", { mode: "simple" })).toBe("t[");
  });

  test("simple mode still permits W as an A/O/U modifier", () => {
    expect(convertTelexToken("dduowngf", { mode: "simple" })).toBe("đường");
  });
});

describe("free shape marks", () => {
  test("are enabled by default and can be disabled", () => {
    expect(convertTelexToken("dduongwf")).toBe("đường");
    expect(convertTelexToken("dduongwf", { freeShapeMarks: false })).not.toBe(
      "đường",
    );
  });
});

describe("spell checking and tone placement", () => {
  test("uses classic UniKey tone placement for valid syllables", () => {
    const placement = findTelexToneCarrier("đương");
    expect(placement.index).toBe(2);
    expect(placement.source).toMatch(/^v7-broad-/);
    expect(applyTelexTone("đương", "grave")).toBe("đường");
    expect(convertTelexToken("quys")).toBe("quý");
    expect(convertTelexToken("tuys")).toBe("túy");
    expect(convertTelexToken("ruouj")).toBe("ruọu");
    expect(convertTelexToken("uro")).toBe("ủo");
  });

  test("rejects invalid Vietnamese syllables during typing", () => {
    expect(convertTelexToken("uoes")).toBe("uoes");
    expect(convertTelexToken("giis")).toBe("giis");
    expect(convertTelexToken("guitar")).toBe("guitar");
    expect(convertTelexToken("bapf")).toBe("bapf");
    expect(convertTelexToken("baps")).toBe("báp");
    expect(convertTelexToken("bapj")).toBe("bạp");
    expect(convertTelexToken("boongw")).toBe("bôngw");
    expect(convertTelexToken("sa")).toBe("sa");
    expect(convertTelexToken("fa")).toBe("fa");
  });
});

describe("z tone-zero semantics", () => {
  test("clears a tone and only a tone", () => {
    expect(convertTelex("toansz ")).toBe("toan ");
    expect(convertTelex("aasz ")).toBe("â ");
    expect(convertTelex("aaz ")).toBe("âz ");
    expect(convertTelex("ddz ")).toBe("đz ");
  });

  test("a second z is literal instead of restoring the cleared tone", () => {
    expect(convertTelex("toanszz ")).toBe("toanz ");
  });

  test("z does not clear tones inside invalid non-Vietnamese words", () => {
    expect(convertTelexToken("worldz")).toBe("ửoldz");
    expect(convertTelex("worldz ")).toBe("worldz ");
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

  test("deletes visible characters on backspace and relocates tone", () => {
    const composer = new TelexComposer();
    for (const key of "tieengs") composer.push(key);
    expect(composer.text).toBe("tiếng");
    expect(composer.backspace()).toBe("tiến");
    expect(composer.push("g")).toBe("tiếng");

    composer.clear();
    for (const key of "hoafng") composer.push(key);
    expect(composer.text).toBe("hoàng");
    expect(composer.backspace()).toBe("hoàn");
    expect(composer.backspace()).toBe("hòa");

    // Deleting a marked/toned vowel must not resurrect deleted letters on auto-restore.
    composer.clear();
    for (const key of "RUOUJW") composer.push(key);
    expect(composer.text).toBe("RƯỢU");
    expect(composer.backspace()).toBe("RƯỢ");
    expect(composer.backspace()).toBe("RƯ");
    expect(composer.push("g")).toBe("RƯg");
    expect(composer.push(".")).toBe("RƯg.");
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
