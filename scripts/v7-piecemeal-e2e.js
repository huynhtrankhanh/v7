#!/usr/bin/env node
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.V7_E2E_PORT || 3998);

const QWERTY = {
  "#": "q", S: "a", T: "w", K: "s", P: "e", W: "d", H: "r", R: "f",
  A: "c", O: "v", "*": " ",
  E: "n", U: "m", F: "u", B: "k", L: "o", G: "l", RT: "p", RS: ";"
};

const LEFT_CONSONANTS = new Map([
  ["0", 0], ["b", 11], ["k", 5], ["d", 29], ["dd", 7], ["ph", 12],
  ["g", 15], ["h", 16], ["z", 30], ["kh", 23], ["l", 19], ["m", 24],
  ["n", 28], ["nh", 31], ["ng", 13], ["p", 8], ["r", 17], ["s", 14],
  ["t", 4], ["th", 20], ["tr", 21], ["v", 9], ["x", 25], ["ch", 22]
]);
const RIGHT_CONSONANTS = new Map([
  ["0", 0], ["b", 11], ["k", 5], ["d", 29], ["dd", 7], ["ph", 12],
  ["g", 15], ["h", 16], ["z", 30], ["kh", 23], ["l", 19], ["m", 24],
  ["n", 28], ["nh", 31], ["ng", 13], ["p", 8], ["r", 17], ["s", 14],
  ["t", 4], ["th", 20], ["tr", 21], ["v", 9], ["x", 25], ["ch", 22]
]);
const TONE_BITS = new Map([[0, 0], [1, 1], [2, 2], [3, 4], [4, 3], [5, 6], [6, 5], [7, 7]]);

function minimalModelPath() {
  const modelPath = path.join(os.tmpdir(), `v7-minimal-${process.pid}.arpa`);
  fs.writeFileSync(
    modelPath,
    "\\data\\\n" +
      "ngram 1=3\n" +
      "ngram 2=1\n\n" +
      "\\1-grams:\n" +
      "-0.3010\t<s>\t-0.3010\n" +
      "-0.3010\t</s>\t-0.3010\n" +
      "-0.3010\t<unk>\t-0.3010\n\n" +
      "\\2-grams:\n" +
      "-0.3010\t<s>\t</s>\n\n" +
      "\\end\\\n"
  );
  return modelPath;
}

function waitForOutput(proc, substring, timeoutMs = 30000) {
  let logs = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${substring}". Logs:\n${logs}`)), timeoutMs);
    const onData = (data) => {
      logs += data.toString();
      if (!logs.includes(substring)) return;
      clearTimeout(timer);
      proc.stdout.off("data", onData);
      proc.stderr.off("data", onData);
      resolve();
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with ${code}. Logs:\n${logs}`));
    });
  });
}

function parseCode(code) {
  const consonants = [...LEFT_CONSONANTS.keys()].sort((a, b) => b.length - a.length);
  const consonant = consonants.find((prefix) => code.startsWith(prefix));
  if (!consonant) throw new Error(`Cannot parse V7 code: ${code}`);
  return {
    consonant,
    vowel: code[consonant.length],
    tone: Number(code[consonant.length + 1])
  };
}

function leftKeys(code) {
  const parsed = parseCode(code);
  const mask = LEFT_CONSONANTS.get(parsed.consonant);
  if (mask === undefined) throw new Error(`Unsupported left consonant: ${parsed.consonant}`);
  const keys = [];
  if (mask & 1) keys.push(QWERTY["#"]);
  if (mask & 2) keys.push(QWERTY.S);
  if (mask & 4) keys.push(QWERTY.T);
  if (mask & 8) keys.push(QWERTY.P);
  if (mask & 16) keys.push(QWERTY.H);
  if (parsed.vowel === "a") keys.push(QWERTY.A);
  if (parsed.vowel === "o") keys.push(QWERTY.O);
  if (parsed.vowel === "i") keys.push(QWERTY.A, QWERTY.O);
  if (!["a", "o", "i"].includes(parsed.vowel)) throw new Error(`E2E avoids suffix vowels, got: ${code}`);
  const toneMask = TONE_BITS.get(parsed.tone);
  if (toneMask & 1) keys.push(QWERTY.K);
  if (toneMask & 2) keys.push(QWERTY.W);
  if (toneMask & 4) keys.push(QWERTY.R);
  return keys;
}

function rightKeys(code) {
  const parsed = parseCode(code);
  const mask = RIGHT_CONSONANTS.get(parsed.consonant);
  if (mask === undefined) throw new Error(`Unsupported right consonant: ${parsed.consonant}`);
  const keys = [];
  if (parsed.vowel === "a") keys.push(QWERTY.U);
  if (parsed.vowel === "o") keys.push(QWERTY.E);
  if (parsed.vowel === "i") keys.push(QWERTY.U, QWERTY.E);
  if (!["a", "o", "i"].includes(parsed.vowel)) throw new Error(`E2E avoids suffix vowels, got: ${code}`);
  if (mask & 16) keys.push(QWERTY.F);
  if (mask & 8) keys.push(QWERTY.P);
  if (mask & 4) keys.push(QWERTY.L);
  if (mask & 2) keys.push(QWERTY.RS);
  if (mask & 1) keys.push(QWERTY.RT);
  const toneMask = TONE_BITS.get(parsed.tone);
  if (toneMask & 4) keys.push(QWERTY.R);
  if (toneMask & 2) keys.push(QWERTY.B);
  if (toneMask & 1) keys.push(QWERTY.G);
  return keys;
}

async function pressChord(page, keys) {
  for (const key of keys) await page.keyboard.down(key);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

async function waitForMarkerCount(page, count) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".piecemeal-syllable").length === expected,
    { timeout: 10000 },
    count
  );
}

async function assertMarkerTexts(page, expected, label) {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".piecemeal-syllable").length === count,
    { timeout: 10000 },
    expected.length
  );
  const markers = await snapshotMarkers(page);
  const texts = markers.map((marker) => marker.text);
  if (JSON.stringify(texts) !== JSON.stringify(expected)) {
    throw new Error(`${label} marker text mismatch. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(texts)}`);
  }
}

async function snapshotMarkers(page) {
  return await page.$$eval(".piecemeal-syllable", (nodes) =>
    nodes.map((node) => ({
      text: node.textContent || "",
      active: node.classList.contains("active")
    }))
  );
}

async function main() {
  const modelPath = minimalModelPath();
  const server = spawn(
    "cargo",
    [
      "run",
      "--manifest-path",
      path.join(ROOT, "inference-rs", "Cargo.toml"),
      "--",
      "--model-path",
      modelPath,
      "--server",
      "--static-dir",
      path.join(ROOT, "static"),
      "--port",
      String(PORT)
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
  );

  let browser;
  try {
    await waitForOutput(server, "Listening on");
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: "networkidle0" });

    const fixedChords = [
      { keys: [QWERTY.T, QWERTY.A], text: "ta" },
      { keys: [QWERTY.P, QWERTY.H, QWERTY.A, QWERTY.L], text: "má" },
      { keys: [QWERTY.K, QWERTY.A], text: "ca" }
    ];

    for (let i = 0; i < fixedChords.length; i++) {
      await pressChord(page, fixedChords[i].keys);
      await assertMarkerTexts(page, fixedChords.slice(0, i + 1).map((entry) => entry.text), `fixed-only ${i + 1}`);
    }

    const codes = ["tro2", "ma1", "ko0", "no1", "ra6", "xa3"];
    for (let i = 0; i < codes.length; i += 2) {
      await pressChord(page, [...leftKeys(codes[i]), QWERTY["*"], ...rightKeys(codes[i + 1])]);
      await waitForMarkerCount(page, Math.min(fixedChords.length + i + 2, 9));
    }

    await waitForMarkerCount(page, 9);
    const initialMarkers = await snapshotMarkers(page);
    const fixedMarkerTexts = initialMarkers.slice(0, fixedChords.length).map((marker) => marker.text);
    const expectedFixedTexts = fixedChords.map((entry) => entry.text);
    if (JSON.stringify(fixedMarkerTexts) !== JSON.stringify(expectedFixedTexts)) {
      throw new Error(`Fixed syllables were not preserved in mixed markers. Expected ${JSON.stringify(expectedFixedTexts)}, got ${JSON.stringify(fixedMarkerTexts)}`);
    }
    if (initialMarkers.some((marker) => marker.text.trim() === "")) {
      throw new Error(`Blank marker after V7 entry: ${JSON.stringify(initialMarkers)}`);
    }

    const entryStrokes = [
      [QWERTY.T],
      [QWERTY.P],
      [QWERTY.H],
      [QWERTY.T, QWERTY.K],
      [QWERTY.P, QWERTY.W],
      [QWERTY.H, QWERTY.R],
      [QWERTY.K],
      [QWERTY.W],
      [QWERTY.R]
    ];

    for (let cursor = 0; cursor < entryStrokes.length; cursor++) {
      await pressChord(page, entryStrokes[cursor]);
      await page.waitForFunction(
        (index) => {
          const markers = Array.from(document.querySelectorAll(".piecemeal-syllable"));
          return markers.length === 9 && markers[index]?.classList.contains("active");
        },
        { timeout: 5000 },
        cursor
      );
      const markers = await snapshotMarkers(page);
      const activeCount = markers.filter((marker) => marker.active).length;
      if (activeCount !== 1) {
        throw new Error(`Expected one active marker, got ${activeCount}: ${JSON.stringify(markers)}`);
      }
      if (markers.some((marker) => marker.text.trim() === "")) {
        throw new Error(`Blank marker at cursor ${cursor}: ${JSON.stringify(markers)}`);
      }
      await pressChord(page, [QWERTY.P]);
      await waitForMarkerCount(page, 9);
    }
  } finally {
    if (browser) await browser.close();
    server.kill("SIGINT");
    fs.rmSync(modelPath, { force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
