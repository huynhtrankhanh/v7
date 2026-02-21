(function () {
  const STORAGE_PREFIX = "v7.practice.leaderboard.";
  const ROUND_SECONDS = 60;

  const MODES = [
    { id: "partial-left", label: "Partial syllable, left hand", type: "partial", hand: "left" },
    { id: "partial-right", label: "Partial syllable, right hand", type: "partial", hand: "right" },
    { id: "partial-random", label: "Partial syllable, random hand", type: "partial", hand: "random" },
    { id: "full", label: "Full syllable", type: "full", hand: "both" }
  ];

  const qwertyToUnique = {
    q: "#", a: "S", w: "T", s: "K", e: "P", d: "W", r: "H", f: "R",
    c: "A", v: "O", n: "E", m: "U", u: "F", j: "RR", i: "PP", k: "B", o: "L", l: "G", p: "TT", ";": "SS", " ": "*"
  };

  const LEFT_CONSONANT = {
    "0": [], b: ["#", "S", "P"], ch: ["S", "T", "H"], d: ["#", "T", "P", "H"], dd: ["#", "S", "T"],
    g: ["#", "S", "T", "P"], h: ["H"], k: ["#", "T"], kh: ["#", "S", "T", "H"], l: ["#", "S", "H"],
    m: ["P", "H"], n: ["T", "P", "H"], ng: ["#", "T", "P"], nh: ["#", "S", "T", "P", "H"], p: ["P"],
    ph: ["T", "P"], r: ["#", "H"], s: ["S", "T", "P"], t: ["T"], th: ["T", "H"], tr: ["#", "T", "H"],
    v: ["#", "P"], w: ["#", "S"], x: ["#", "P", "H"], z: ["S", "T", "P", "H"]
  };

  const RIGHT_CONSONANT = {
    "0": [], b: ["TT", "SS", "PP"], ch: ["SS", "L", "F"], d: ["TT", "L", "PP", "F"], dd: ["TT", "SS", "L"],
    g: ["TT", "SS", "L", "PP"], h: ["F"], k: ["TT", "L"], kh: ["TT", "SS", "L", "F"], l: ["TT", "SS", "F"],
    m: ["PP", "F"], n: ["L", "PP", "F"], ng: ["TT", "L", "PP"], nh: ["TT", "SS", "L", "PP", "F"], p: ["PP"],
    ph: ["L", "PP"], r: ["TT", "F"], s: ["SS", "L", "PP"], t: ["L"], th: ["L", "F"], tr: ["TT", "L", "F"],
    v: ["TT", "PP"], w: ["TT", "SS"], x: ["TT", "PP", "F"], z: ["SS", "L", "PP", "F"]
  };

  const LEFT_TONE = { "0": [], "1": ["K"], "2": ["W"], "3": ["R"], "4": ["K", "W"], "5": ["W", "R"], "6": ["K", "R"], "7": ["K", "W", "R"] };
  const RIGHT_TONE = { "0": [], "1": ["G"], "2": ["B"], "3": ["RR"], "4": ["G", "B"], "5": ["B", "RR"], "6": ["G", "RR"], "7": ["G", "B", "RR"] };

  function mapKeyUnique(key) {
    const k = key.toLowerCase();
    // -D/-Z are mirrored suffix keys; each is reachable from either of two QWERTY keys.
    if (k === "t" || k === "g") return "D";
    if (k === "y" || k === "h") return "Z";
    return qwertyToUnique[k] || null;
  }

  function normalizeConsonant(cons) {
    if (cons === "đ") return "dd";
    return cons;
  }

  function parseCodeKey(codeKey) {
    const parts = codeKey.split("_");
    if (parts.length !== 3) return null;
    const [cons, vowel, tone] = parts;
    return { consonant: normalizeConsonant(cons), vowel, tone };
  }

  function enumerateRegex(regex) {
    const chars = Array.from(regex);
    let i = 0;

    function expandExpr() {
      const alternatives = [];
      let current = [""];

      while (i < chars.length) {
        const c = chars[i];
        if (c === ")") break;

        if (c === "(") {
          i += 1;
          if (chars[i] === "?") {
            i += 1;
            if (chars[i] === ":") i += 1;
          }
          const nested = expandExpr();
          if (chars[i] === ")") i += 1;

          const optional = chars[i] === "?";
          if (optional) i += 1;

          const next = [];
          current.forEach((s) => {
            nested.forEach((n) => next.push(s + n));
            if (optional) next.push(s);
          });
          current = next;
          continue;
        }

        if (c === "[") {
          i += 1;
          const classChars = [];
          while (i < chars.length && chars[i] !== "]") {
            classChars.push(chars[i]);
            i += 1;
          }
          if (chars[i] === "]") i += 1;

          const optional = chars[i] === "?";
          if (optional) i += 1;

          const next = [];
          current.forEach((s) => {
            classChars.forEach((cc) => next.push(s + cc));
            if (optional) next.push(s);
          });
          current = next;
          continue;
        }

        if (c === "|") {
          alternatives.push(current);
          current = [""];
          i += 1;
          continue;
        }

        let literal = c;
        i += 1;
        if (literal === "\\" && i < chars.length) {
          literal = chars[i];
          i += 1;
        }

        const optional = chars[i] === "?";
        if (optional) i += 1;

        if (optional) {
          const next = [];
          current.forEach((s) => {
            next.push(s + literal);
            next.push(s);
          });
          current = next;
        } else {
          current = current.map((s) => s + literal);
        }
      }

      alternatives.push(current);
      return alternatives.flat();
    }

    return expandExpr();
  }

  function buildSyllableEntriesFromRegexMap(regexMap) {
    const entries = [];
    Object.entries(regexMap).forEach(([codeKey, regex]) => {
      const code = parseCodeKey(codeKey);
      if (!code || typeof regex !== "string") return;
      enumerateRegex(regex).forEach((syllable) => {
        entries.push({ syllable, code });
      });
    });
    return entries;
  }

  function sideChordSymbols(code, side) {
    const consMap = side === "left" ? LEFT_CONSONANT : RIGHT_CONSONANT;
    const toneMap = side === "left" ? LEFT_TONE : RIGHT_TONE;
    const set = new Set();

    (consMap[code.consonant] || []).forEach((k) => set.add(k));
    (toneMap[code.tone] || []).forEach((k) => set.add(k));

    if (side === "left") {
      if (code.vowel === "a") set.add("A");
      else if (code.vowel === "o") set.add("O");
      else if (code.vowel === "i") { set.add("A"); set.add("O"); }
      else if (code.vowel === "u") set.add("D");
    } else {
      if (code.vowel === "a") set.add("U");
      else if (code.vowel === "o") set.add("E");
      else if (code.vowel === "i") { set.add("U"); set.add("E"); }
      else if (code.vowel === "u") set.add("Z");
    }

    return set;
  }

  function buildExpectedChordSymbols(code, modeId, hand) {
    const expected = new Set();

    if (modeId === "full") {
      sideChordSymbols(code, "left").forEach((k) => expected.add(k));
      sideChordSymbols(code, "right").forEach((k) => expected.add(k));
      expected.add("*");
      return expected;
    }

    const side = hand === "right" ? "right" : "left";
    sideChordSymbols(code, side).forEach((k) => expected.add(k));
    expected.add("*");
    return expected;
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  function readLeaderboard(modeId) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + modeId);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((n) => Number.isInteger(n) && n >= 0) : [];
    } catch (_) {
      return [];
    }
  }

  function writeLeaderboard(modeId, score) {
    if (!Number.isInteger(score) || score < 0) return;
    const next = readLeaderboard(modeId);
    next.push(score);
    next.sort((a, b) => b - a);
    localStorage.setItem(STORAGE_PREFIX + modeId, JSON.stringify(next.slice(0, 10)));
  }

  function initPracticePage() {
    const modeSelect = document.getElementById("mode-select");
    const startBtn = document.getElementById("start-btn");
    const timeLeft = document.getElementById("time-left");
    const scoreEl = document.getElementById("score");
    const bestEl = document.getElementById("best");
    const promptLabel = document.getElementById("prompt-label");
    const targetEl = document.getElementById("target");
    const statusEl = document.getElementById("status");
    const leaderboardEl = document.getElementById("leaderboard");

    const state = {
      entries: [],
      running: false,
      modeId: MODES[0].id,
      score: 0,
      time: ROUND_SECONDS,
      timer: null,
      prompt: null,
      lastSyllable: null
    };

    let heldKeys = new Set();
    let strokeKeys = new Set();

    function currentMode() {
      return MODES.find((m) => m.id === state.modeId) || MODES[0];
    }

    function refreshLeaderboard() {
      const list = readLeaderboard(state.modeId);
      bestEl.textContent = String(list[0] || 0);
      leaderboardEl.innerHTML = "";
      if (list.length === 0) {
        const li = document.createElement("li");
        li.textContent = "No scores yet";
        leaderboardEl.appendChild(li);
        return;
      }
      list.forEach((s) => {
        const li = document.createElement("li");
        li.textContent = String(s);
        leaderboardEl.appendChild(li);
      });
    }

    function setStatus(text, cls) {
      statusEl.textContent = text || "";
      statusEl.className = "status" + (cls ? " " + cls : "");
    }

    function pickPrompt() {
      const mode = currentMode();
      if (!state.entries.length) {
        state.prompt = null;
        targetEl.textContent = "(loading...)";
        return;
      }
      const entry = state.entries[Math.floor(Math.random() * state.entries.length)];
      const pickedEntry = state.entries.length > 1 && state.lastSyllable === entry.syllable
        ? state.entries.find((candidate) => candidate.syllable !== state.lastSyllable) || entry
        : entry;
      let hand = mode.hand;
      if (mode.hand === "random") hand = Math.random() < 0.5 ? "left" : "right";
      state.prompt = { entry: pickedEntry, hand };
      state.lastSyllable = pickedEntry.syllable;
      targetEl.textContent = pickedEntry.syllable;
      const handHint = mode.id === "full" ? "Both hands" : `${hand.charAt(0).toUpperCase()}${hand.slice(1)} hand`;
      promptLabel.textContent = `${mode.label} — ${handHint}`;
    }

    function endRound() {
      state.running = false;
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
      writeLeaderboard(state.modeId, state.score);
      refreshLeaderboard();
      setStatus(`Time's up! Final score: ${state.score}`, "ok");
      startBtn.disabled = false;
    }

    function startRound() {
      if (!state.entries.length) return;
      state.running = true;
      state.score = 0;
      state.time = ROUND_SECONDS;
      scoreEl.textContent = "0";
      timeLeft.textContent = String(ROUND_SECONDS);
      setStatus("", "");
      startBtn.disabled = true;
      startBtn.blur();
      pickPrompt();

      state.timer = setInterval(() => {
        state.time -= 1;
        timeLeft.textContent = String(state.time);
        if (state.time <= 0) endRound();
      }, 1000);
    }

    function handleStroke(strokeSet) {
      if (!state.running || !state.prompt) return;
      // A lone '*' is ignored because valid practice chords must include '*' plus the target syllable keys.
      if (strokeSet.size === 1 && strokeSet.has("*")) return;
      const expected = buildExpectedChordSymbols(state.prompt.entry.code, state.modeId, state.prompt.hand);
      if (setsEqual(strokeSet, expected)) {
        state.score += 1;
        scoreEl.textContent = String(state.score);
        setStatus("Correct", "ok");
        pickPrompt();
      } else {
        setStatus("Wrong chord. Try again.", "bad");
      }
    }

    modeSelect.innerHTML = "";
    MODES.forEach((m) => {
      const option = document.createElement("option");
      option.value = m.id;
      option.textContent = m.label;
      modeSelect.appendChild(option);
    });

    modeSelect.addEventListener("change", () => {
      state.modeId = modeSelect.value;
      refreshLeaderboard();
      if (!state.running) {
        targetEl.textContent = "-";
        promptLabel.textContent = "Press Start";
        setStatus("", "");
      }
    });

    startBtn.addEventListener("click", startRound);

    document.addEventListener("keydown", (e) => {
      if (e.target && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName)) return;
      if (e.repeat) return;
      const mapped = mapKeyUnique(e.key);
      if (!mapped) return;
      heldKeys.add(mapped);
      strokeKeys.add(mapped);
      e.preventDefault();
    });

    document.addEventListener("keyup", (e) => {
      const mapped = mapKeyUnique(e.key);
      if (!mapped) return;
      heldKeys.delete(mapped);
      if (heldKeys.size === 0 && strokeKeys.size > 0) {
        handleStroke(new Set(strokeKeys));
        strokeKeys = new Set();
      }
      e.preventDefault();
    });

    refreshLeaderboard();

    fetch("/generated_regexes.json")
      .then((resp) => resp.json())
      .then((regexMap) => {
        state.entries = buildSyllableEntriesFromRegexMap(regexMap);
        if (!state.entries.length) {
          targetEl.textContent = "(no syllables loaded)";
        }
      })
      .catch(() => {
        targetEl.textContent = "(failed to load syllables)";
      });
  }

  const exported = {
    enumerateRegex,
    buildSyllableEntriesFromRegexMap,
    parseCodeKey,
    buildExpectedChordSymbols
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }

  if (typeof window !== "undefined" && typeof document !== "undefined" && document.getElementById("mode-select")) {
    window.practiceGame = exported;
    initPracticePage();
  }
})();
