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
  buildExpectedChordSymbolOptions,
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

  test("buildExpectedChordSymbolOptions returns all valid chords for syllables with multiple v7 codes", () => {
    const codeA = parseCodeKey("tr_o_2");
    const codeB = parseCodeKey("m_a_1");
    const options = buildExpectedChordSymbolOptions([
      { syllable: "demo", code: codeA },
      { syllable: "demo", code: codeB }
    ], "demo", "partial-left", "left");
    expect(options).toHaveLength(2);
    expect(options).toEqual(expect.arrayContaining([
      buildExpectedChordSymbols(codeA, "partial-left", "left"),
      buildExpectedChordSymbols(codeB, "partial-left", "left")
    ]));
  });

  test("strokeSetToSyllable decodes full syllable using parse/assemble logic", () => {
    expect(strokeSetToSyllable(new Set(["T", "A", "L"]))).toBe("tá");
  });

  test("decodeEmbeddedRegexMap reconstructs full regex map from structured marker", async () => {
    const expected = require("../generated_regexes.json");
    await expect(decodeEmbeddedRegexMap("G4")).resolves.toEqual(expected);
  });
});

describe("practice game page behavior", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.documentElement.innerHTML = practiceHtml;
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("starts a round from keyboard without clicking start button", async () => {
    window.eval(scriptMatch[1]);
    await Promise.resolve();
    await Promise.resolve();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
    const promptLabel = document.getElementById("prompt-label");
    expect(startBtn.disabled).toBe(true);
    expect(promptLabel?.textContent).not.toBe("Press Start");
  });

  test("renders leaderboard scores linearly in a single list item", async () => {
    localStorage.setItem("v7.practice.leaderboard.partial-left", JSON.stringify([12, 9, 7]));
    window.eval(scriptMatch[1]);
    await Promise.resolve();
    await Promise.resolve();

    const leaderboardItems = document.querySelectorAll("#leaderboard li");
    expect(leaderboardItems).toHaveLength(1);
    expect(leaderboardItems[0].textContent).toBe("#1: 12 · #2: 9 · #3: 7");
  });
});
