const qwertyToUnique = {
  q: "#", a: "S", w: "T", s: "K", e: "P", d: "W", r: "H", f: "R",
  c: "A", v: "O", n: "E", m: "U", u: "F", j: "R", i: "P", k: "B", o: "L", l: "G", p: "T", ";": "S", " ": "*"
};
const order = ["#", "S", "T", "K", "P", "W", "H", "R", "A", "O", "*", "E", "U", "F", "R", "P", "B", "L", "G", "T", "S", "D", "Z"];

const stenographyMap = {
  PW: "b", K: "c", KH: "ch", KWR: "d", TK: "đ", TP: "ph", TKPW: "g", H: "h", KWH: "gi", KHR: "kh", HR: "l", PH: "m",
  TPH: "n", TPR: "nh", TPW: "ng/ngh", P: "p", R: "r", KP: "s", T: "t", TH: "th", TR: "tr", W: "v", WR: "x"
};
const vowelMap = { OEU: "iê/ia", AEU: "ua/uô", AOE: "ưa/ươ", AOU: "ư", OU: "ơ", OE: "ô", O: "o", AU: "ê", E: "e", EU: "i", A: "a", AE: "ă", AO: "â", U: "u", AOEU: "y" };
const finalMap = { FP: "j", F: "w", P: "m", R: "n", FR: "ng", RP: "nh" };
const toneMap = { L: "sắc", G: "huyền", B: "hỏi", LG: "ngã", BG: "nặng", BL: "ách", BLG: "ạch" };
const toneAccents = {
  a: { "": "a", sắc: "á", huyền: "à", hỏi: "ả", ngã: "ã", nặng: "ạ" }, ă: { "": "ă", sắc: "ắ", huyền: "ằ", hỏi: "ẳ", ngã: "ẵ", nặng: "ặ" },
  â: { "": "â", sắc: "ấ", huyền: "ầ", hỏi: "ẩ", ngã: "ẫ", nặng: "ậ" }, e: { "": "e", sắc: "é", huyền: "è", hỏi: "ẻ", ngã: "ẽ", nặng: "ẹ" },
  ê: { "": "ê", sắc: "ế", huyền: "ề", hỏi: "ể", ngã: "ễ", nặng: "ệ" }, i: { "": "i", sắc: "í", huyền: "ì", hỏi: "ỉ", ngã: "ĩ", nặng: "ị" },
  o: { "": "o", sắc: "ó", huyền: "ò", hỏi: "ỏ", ngã: "õ", nặng: "ọ" }, ô: { "": "ô", sắc: "ố", huyền: "ồ", hỏi: "ổ", ngã: "ỗ", nặng: "ộ" },
  ơ: { "": "ơ", sắc: "ớ", huyền: "ờ", hỏi: "ở", ngã: "ỡ", nặng: "ợ" }, u: { "": "u", sắc: "ú", huyền: "ù", hỏi: "ủ", ngã: "ũ", nặng: "ụ" },
  ư: { "": "ư", sắc: "ứ", huyền: "ừ", hỏi: "ử", ngã: "ữ", nặng: "ự" }, y: { "": "y", sắc: "ý", huyền: "ỳ", hỏi: "ỷ", ngã: "ỹ", nặng: "ỵ" }
};

const consonantIntMap = { 0: "0", [2 * 4 + 3]: "b", [1 * 4 + 1]: "k", [7 * 4 + 1]: "d", [1 * 4 + 3]: "dd", [3 * 4 + 0]: "ph", [3 * 4 + 3]: "g", [4 * 4 + 0]: "h", [7 * 4 + 2]: "z", [5 * 4 + 3]: "kh", [4 * 4 + 3]: "l", [6 * 4 + 0]: "m", [7 * 4 + 0]: "n", [7 * 4 + 3]: "nh", [3 * 4 + 1]: "ng", [2 * 4 + 0]: "p", [4 * 4 + 1]: "r", [3 * 4 + 2]: "s", [1 * 4 + 0]: "t", [5 * 4 + 0]: "th", [5 * 4 + 1]: "tr", [2 * 4 + 1]: "v", [6 * 4 + 1]: "x", 3: "w", [5 * 4 + 2]: "ch" };
const vowelIntMap = { 1: "a", 2: "o", 3: "i", 0: "e" };

function remapTone(t) { if (t === 3) return 4; if (t === 4) return 3; if (t === 5) return 6; if (t === 6) return 5; return t; }
function mapKeyUnique(k) {
  const key = k.toLowerCase();
  if (key === "t" || key === "g") return "D";
  if (key === "y" || key === "h") return "Z";
  return qwertyToUnique[key] || null;
}
function parse(stroke) {
  let s = stroke, capitalize = false;
  if (s.startsWith("#")) { capitalize = true; s = s.slice(1); }
  const hyphenPos = s.indexOf("-");
  const left = hyphenPos !== -1 ? s.slice(0, hyphenPos) : s;
  const right = hyphenPos !== -1 ? s.slice(hyphenPos + 1) : "";
  const initials = Object.keys(stenographyMap).sort((a, b) => b.length - a.length);
  let initialConsonant = "", initialSteno = "";
  for (const steno of initials) if (left.startsWith(steno)) { initialConsonant = stenographyMap[steno]; initialSteno = steno; break; }
  let remaining = left.slice(initialSteno.length);
  const vowels = Object.keys(vowelMap).sort((a, b) => b.length - a.length);
  let vowel = "", vowelSteno = "";
  for (const steno of vowels) if (remaining.startsWith(steno)) { vowel = vowelMap[steno]; vowelSteno = steno; break; }
  if (!vowel) return null;
  remaining = remaining.slice(vowelSteno.length);
  let finalConsonant = "", finalSteno = "", tone = "";
  const finals = Object.keys(finalMap).sort((a, b) => b.length - a.length);
  for (const steno of finals) if (right.startsWith(steno)) { finalConsonant = finalMap[steno]; finalSteno = steno; break; }
  const toneSteno = right.slice(finalSteno.length);
  tone = toneMap[toneSteno] || "";
  if (remaining) {
    if (remaining === "S") {
      if (initialConsonant === "c") initialConsonant = "q";
      if (vowel.includes("ua") || vowel.includes("uô")) vowel = vowel.replace("ua", "oa").replace("uô", "o");
    } else return null;
  }
  if (initialConsonant === "ng/ngh" && (vowel.startsWith("i") || vowel.startsWith("e") || vowel.startsWith("ê"))) initialConsonant = "ngh";
  else if (initialConsonant === "ng/ngh") initialConsonant = "ng";
  if (initialConsonant === "g" && (vowel.startsWith("i") || vowel.startsWith("e") || vowel.startsWith("ê"))) initialConsonant = "gh";
  if (finalConsonant === "j") finalConsonant = vowel.includes("i") || vowel.includes("ê") || vowel.includes("y") ? "y" : "i";
  if (finalConsonant === "w") finalConsonant = vowel.includes("a") || vowel.includes("ă") || vowel.includes("â") ? "u" : "o";
  return { capitalize, initialConsonant, vowel, finalConsonant, tone };
}
function assemble(parsed) {
  const initial = parsed.initialConsonant;
  let vowel = parsed.vowel.includes("/") ? parsed.vowel.split("/")[0] : parsed.vowel;
  const tone = parsed.tone;
  const parts = ["iê", "ươ", "uô", "ia", "ưa", "ua", "yê", "â", "ă", "ê", "ô", "ơ", "ư", "a", "e", "i", "o", "u", "y"];
  let accented = false;
  for (const p of parts) {
    const idx = vowel.indexOf(p);
    if (idx !== -1) {
      let replacement = p;
      const accentedChar = p.length > 1 ? p[p.length - 1] : p;
      if (toneAccents[accentedChar] && toneAccents[accentedChar][tone]) {
        replacement = p.length > 1 ? p.slice(0, -1) + toneAccents[accentedChar][tone] : toneAccents[accentedChar][tone];
        accented = true;
      }
      vowel = vowel.slice(0, idx) + replacement + vowel.slice(idx + p.length);
      break;
    }
  }
  if (!accented && tone && vowel) {
    const i = vowel.length - 1;
    const c = vowel[i];
    if (toneAccents[c] && toneAccents[c][tone]) vowel = vowel.slice(0, i) + toneAccents[c][tone];
  }
  const text = initial + vowel + parsed.finalConsonant;
  return parsed.capitalize ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
function decodePartialCode(stroke, hand) {
  if (!stroke.includes("*")) return null;
  const [left, rightRaw] = stroke.split("*");
  if (hand === "left") {
    const right = rightRaw || "";
    const clean = right.replace(/D/g, "");
    if (clean) return null;
    const lk = (k) => left.includes(k) ? 1 : 0;
    const c = lk("#") + lk("S") * 2 + lk("T") * 4 + lk("P") * 8 + lk("H") * 16;
    const t = lk("K") + lk("W") * 2 + lk("R") * 4;
    const v = lk("A") + lk("O") * 2;
    const consonant = consonantIntMap[c];
    if (consonant === undefined) return null;
    const vowel = v === 0 ? (right.includes("D") ? "u" : "e") : vowelIntMap[v];
    return `${consonant}_${vowel}_${remapTone(t)}`;
  }
  const leftClean = (left || "").replace(/#/g, "");
  if (leftClean) return null;
  const right = rightRaw || "";
  const hasZ = right.includes("Z");
  const cleanRight = right.replace(/Z/g, "");
  const rk = (k) => cleanRight.includes(k) ? 1 : 0;
  const c = rk("T") + rk("S") * 2 + rk("L") * 4 + rk("P") * 8 + rk("F") * 16;
  const t = rk("G") + rk("B") * 2 + rk("R") * 4;
  const v = rk("U") + rk("E") * 2;
  const consonant = consonantIntMap[c];
  if (consonant === undefined) return null;
  const vowel = v === 0 ? (hasZ ? "u" : "e") : vowelIntMap[v];
  return `${consonant}_${vowel}_${remapTone(t)}`;
}

const modeEl = document.getElementById("mode");
const startEl = document.getElementById("start");
const promptEl = document.getElementById("prompt");
const statusEl = document.getElementById("status");
const timeEl = document.getElementById("time");
const scoreEl = document.getElementById("score");
const leaderboardEl = document.getElementById("leaderboard");

let mapping = {};
let allSyllables = [];
let heldKeys = new Set();
let strokeKeys = new Set();
let timer = null;
let timeLeft = 60;
let score = 0;
let active = false;
let current = null;

function leaderboardKey(mode) { return `v7.practice.${mode}`; }
function getLeaderboard(mode) { try { return JSON.parse(localStorage.getItem(leaderboardKey(mode)) || "[]"); } catch { return []; } }
function setLeaderboard(mode, scoreValue) {
  const list = getLeaderboard(mode);
  list.push({ score: scoreValue, at: new Date().toISOString() });
  list.sort((a, b) => b.score - a.score);
  localStorage.setItem(leaderboardKey(mode), JSON.stringify(list.slice(0, 10)));
}
function renderLeaderboard() {
  const mode = modeEl.value;
  const list = getLeaderboard(mode);
  leaderboardEl.replaceChildren();
  if (!list.length) { const li = document.createElement("li"); li.textContent = "No scores yet"; leaderboardEl.appendChild(li); return; }
  list.forEach((item) => { const li = document.createElement("li"); li.textContent = `${item.score} (${new Date(item.at).toLocaleDateString()})`; leaderboardEl.appendChild(li); });
}
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function nextPrompt() {
  const mode = modeEl.value;
  if (mode === "full") {
    current = { syllable: pickRandom(allSyllables) };
  } else {
    const hand = mode === "partial-left" ? "left" : mode === "partial-right" ? "right" : (Math.random() < 0.5 ? "left" : "right");
    const entries = Object.entries(mapping).filter(([, values]) => Array.isArray(values) && values.length > 0);
    const [code, syllables] = pickRandom(entries);
    current = { hand, code, syllable: pickRandom(syllables) };
  }
  promptEl.textContent = current.syllable;
  statusEl.className = "muted";
  statusEl.textContent = current.hand ? `Use ${current.hand} hand` : "";
}
function updateStats() { timeEl.textContent = `Time: ${timeLeft}`; scoreEl.textContent = `Score: ${score}`; }
function stopGame() {
  active = false;
  if (timer) clearInterval(timer);
  setLeaderboard(modeEl.value, score);
  renderLeaderboard();
  statusEl.className = "ok";
  statusEl.textContent = `Time up! Final score: ${score}`;
}
function startGame() {
  if (!allSyllables.length) return;
  active = true;
  score = 0;
  timeLeft = 60;
  updateStats();
  nextPrompt();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    timeLeft -= 1;
    updateStats();
    if (timeLeft <= 0) stopGame();
  }, 1000);
}
function serializeStroke() {
  let s = "";
  let hasMiddle = ["A", "O", "*", "E", "U"].some((k) => strokeKeys.has(k));
  let inserted = false;
  const rightStart = order.indexOf("F");
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    if (!hasMiddle && !inserted && i >= rightStart && strokeKeys.has(k)) { s += "-"; inserted = true; }
    if (strokeKeys.has(k)) s += k;
  }
  return s;
}
function handleStroke(stroke) {
  if (!active || !current) return;
  const mode = modeEl.value;
  let ok = false;
  if (mode === "full") {
    const parsed = parse(stroke);
    if (parsed) ok = assemble(parsed) === current.syllable;
  } else {
    const code = decodePartialCode(stroke, current.hand);
    ok = code === current.code;
  }
  if (ok) {
    score += 1;
    updateStats();
    statusEl.className = "ok";
    statusEl.textContent = "Correct";
    nextPrompt();
  } else {
    statusEl.className = "error";
    statusEl.textContent = "Wrong chord, try again";
  }
}

document.addEventListener("keydown", (e) => {
  if (!active || e.repeat) return;
  const mapped = mapKeyUnique(e.key);
  if (!mapped) return;
  heldKeys.add(mapped);
  strokeKeys.add(mapped);
  e.preventDefault();
});
document.addEventListener("keyup", (e) => {
  if (!active) return;
  const mapped = mapKeyUnique(e.key);
  if (!mapped) return;
  heldKeys.delete(mapped);
  if (heldKeys.size === 0 && strokeKeys.size > 0) {
    handleStroke(serializeStroke());
    strokeKeys = new Set();
  }
});

modeEl.addEventListener("change", renderLeaderboard);
startEl.addEventListener("click", startGame);

fetch("/practice/syllables").then((r) => r.json()).then((json) => {
  mapping = json || {};
  allSyllables = Array.from(new Set(Object.values(mapping).flat().filter(Boolean)));
  renderLeaderboard();
  statusEl.textContent = allSyllables.length ? "Press start to begin." : "No syllables available.";
}).catch(() => {
  statusEl.className = "error";
  statusEl.textContent = "Could not load syllable mapping.";
  renderLeaderboard();
});
