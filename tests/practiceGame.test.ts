const fs = require("fs");
const path = require("path");
const vm = require("vm");

const practiceHtml = fs.readFileSync(path.join(__dirname, "../static/practice.html"), "utf8");
const scriptMatch = practiceHtml.match(/<script>\n([\s\S]*?)\n\s*<\/script>\s*<\/body>/);
if (!scriptMatch) throw new Error("Embedded practice script not found in practice.html");
const sandbox = { module: { exports: {} }, exports: {}, require, console, Set, Map, Math, JSON, Promise };
vm.runInNewContext(scriptMatch[1], sandbox);

const {
  enumerateRegex,
  buildSyllableEntriesFromRegexMap,
  decodeEmbeddedRegexMap,
  parseCodeKey,
  buildExpectedChordSymbols,
  strokeSetToSyllable
} = sandbox.module.exports;

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

  test("buildExpectedChordSymbols combines left and right syllables for realistic two-syllable prompts", () => {
    const leftCode = parseCodeKey("tr_o_2");
    const rightCode = parseCodeKey("m_a_1");
    const leftOnly = buildExpectedChordSymbols(leftCode, "partial-left", "left");
    const rightOnly = buildExpectedChordSymbols(rightCode, "partial-right", "right");
    leftOnly.delete("*");
    rightOnly.delete("*");

    const expected = buildExpectedChordSymbols({ left: leftCode, right: rightCode }, "realistic-double");
    expect(expected).toEqual(new Set([...leftOnly, ...rightOnly, "*"]));
  });

  test("strokeSetToSyllable decodes full syllable using parse/assemble logic", () => {
    expect(strokeSetToSyllable(new Set(["T", "A", "L"]))).toBe("tá");
  });

  test("decodeEmbeddedRegexMap reconstructs full regex map from structured marker", async () => {
    const expected = require("../generated_regexes.json");
    await expect(decodeEmbeddedRegexMap("G4")).resolves.toEqual(expected);
  });
});
