const {
  enumerateRegex,
  buildSyllableEntriesFromRegexMap,
  decodeEmbeddedRegexMap,
  parseCodeKey,
  buildExpectedChordSymbols,
  strokeSetToSyllable
} = require("../static/practice.js");

describe("practice game helpers", () => {
  test("enumerateRegex expands non-capturing groups and optionals", () => {
    const result = enumerateRegex("gi(?:é[cpt]|ế(?:p|ch))");
    expect(result.sort()).toEqual(["giéc", "giép", "giét", "giếch", "giếp"].sort());
  });

  test("buildSyllableEntriesFromRegexMap uses regex expansion", () => {
    const entries = buildSyllableEntriesFromRegexMap({ "z_e_7": "gi(?:ẹ[cpt]|ệ(?:p|ch))" });
    const syllables = entries.map((entry: { syllable: string }) => entry.syllable).sort();
    expect(syllables).toEqual(["giẹp", "giẹc", "giẹt", "giệp", "giệch"].sort());
  });

  test("buildSyllableEntriesFromRegexMap filters out syllables not producible by parse/assemble", () => {
    const entries = buildSyllableEntriesFromRegexMap({ "t_a_1": "(?:tá|zzzz)" });
    const syllables = entries.map((entry: { syllable: string }) => entry.syllable).sort();
    expect(syllables).toEqual(["tá"]);
  });

  test("buildExpectedChordSymbols requires star for partial modes", () => {
    const code = parseCodeKey("tr_o_2");
    const expected = buildExpectedChordSymbols(code, "partial-left", "left");
    expect(expected.has("*")).toBe(true);
  });

  test("strokeSetToSyllable decodes full syllable using parse/assemble logic", () => {
    expect(strokeSetToSyllable(new Set(["T", "A", "L"]))).toBe("tá");
  });

  test("decodeEmbeddedRegexMap decodes gzip+base64 payload", async () => {
    const zlib = require("zlib");
    const payload = Buffer.from(zlib.gzipSync(Buffer.from(JSON.stringify({ t_a_1: "tá" }), "utf8"))).toString("base64");
    await expect(decodeEmbeddedRegexMap(payload)).resolves.toEqual({ t_a_1: "tá" });
  });
});
