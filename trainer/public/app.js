const app = document.getElementById("app");
const accountArea = document.getElementById("account-area");
const announcer = document.getElementById("announcer");

const keyLabels = {
  KeyQ: "Q",
  KeyW: "W",
  KeyE: "E",
  KeyR: "R",
  KeyT: "T",
  KeyY: "Y",
  KeyU: "U",
  KeyI: "I",
  KeyO: "O",
  KeyP: "P",
  KeyA: "A",
  KeyS: "S",
  KeyD: "D",
  KeyF: "F",
  KeyG: "G",
  KeyH: "H",
  KeyJ: "J",
  KeyK: "K",
  KeyL: "L",
  Semicolon: ";",
  KeyC: "C",
  KeyV: "V",
  KeyN: "N",
  KeyM: "M",
  Space: "Space",
};

const stenoForCode = {
  KeyQ: "#",
  KeyA: "S-",
  KeyW: "T-",
  KeyS: "K-",
  KeyE: "P-",
  KeyD: "W-",
  KeyR: "H-",
  KeyF: "R-",
  KeyC: "A",
  KeyV: "O",
  Space: "*",
  KeyN: "E",
  KeyM: "U",
  KeyU: "-F",
  KeyJ: "-R",
  KeyI: "-P",
  KeyK: "-B",
  KeyO: "-L",
  KeyL: "-G",
  KeyP: "-T",
  Semicolon: "-S",
  KeyT: "-D",
  KeyG: "-D",
  KeyY: "-Z",
  KeyH: "-Z",
};

const strokeOrder = [
  "#",
  "S-",
  "T-",
  "K-",
  "P-",
  "W-",
  "H-",
  "R-",
  "A",
  "O",
  "*",
  "E",
  "U",
  "-F",
  "-R",
  "-P",
  "-B",
  "-L",
  "-G",
  "-T",
  "-S",
  "-D",
  "-Z",
];

let status = null;
let telemetryStarted = false;
let stopCapture = null;
let sequence = 0;
let eventQueue = [];
let eventTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: options.body
      ? { "content-type": "application/json", ...(options.headers ?? {}) }
      : options.headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function announce(message) {
  announcer.textContent = "";
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

function accountHeader() {
  accountArea.innerHTML = status?.authenticated
    ? `<span class="muted">${escapeHtml(status.username)}</span>
       <button class="link-button" id="logout">Đăng xuất</button>`
    : "";
  document.getElementById("logout")?.addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    location.reload();
  });
}

function showLogin(error = "") {
  accountArea.innerHTML = "";
  app.innerHTML = `
    <section class="panel narrow">
      <p class="concept">Chỉ dành cho tài khoản được cấp</p>
      <h1>Luyện V7 bằng chính đôi tay.</h1>
      <p class="lede">Gõ trực tiếp bằng bàn phím thật, xem phản hồi ngay và tự ôn lại những lần bấm bạn còn chậm.</p>
      <form id="login-form">
        <label for="username">Tên tài khoản</label>
        <input id="username" name="username" type="text" autocomplete="username" required autofocus />
        <label for="password">Mật khẩu</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required />
        <button class="primary full" type="submit">Vào phòng luyện</button>
        <p class="error" id="login-error" ${error ? "" : "hidden"}>${escapeHtml(error)}</p>
      </form>
      <p class="muted">Không có đăng ký công khai. Quản trị viên phải tạo tài khoản trong cơ sở dữ liệu.</p>
    </section>`;
  document
    .getElementById("login-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api("/api/login", {
          method: "POST",
          body: JSON.stringify({
            username: form.get("username"),
            password: form.get("password"),
          }),
        });
        await boot();
      } catch (loginError) {
        showLogin(loginError.message);
      }
    });
}

function showConsent(error = "") {
  accountHeader();
  app.innerHTML = `
    <section class="panel narrow">
      <p class="concept">Trước khi bắt đầu</p>
      <h1>Bạn quyết định trước khi hệ thống ghi nhận.</h1>
      <p class="lede">Cho đến lúc bạn đồng ý bên dưới, trang không gắn bộ theo dõi và không gửi sự kiện sử dụng.</p>
      <h2>Dữ liệu chi tiết sẽ được lưu</h2>
      <ul class="consent-list">
        <li>mọi lần nhấn và thả phím trong trang, gồm phím, thời điểm và các phím bổ trợ;</li>
        <li>di chuyển con trỏ, cú nhấp và phần tử được nhấp;</li>
        <li>kích thước vùng hiển thị và những lần thay đổi kích thước;</li>
        <li>bản sao cấu trúc trang ở dạng HTML theo chu kỳ — không tạo tệp ảnh;</li>
        <li>lần bấm V7, lỗi, thời gian phản hồi, độ chính xác và lịch tự ôn.</li>
      </ul>
      <p class="muted">Mục đích: phân tích cách học và điều chỉnh bài luyện. Dữ liệu gắn với tài khoản được cấp thủ công.</p>
      <form id="consent-form">
        <label class="consent-check">
          <input type="checkbox" name="accepted" required />
          <span>Tôi đồng ý với toàn bộ việc ghi nhận chi tiết nêu trên và muốn tiếp tục kiểm tra bàn phím.</span>
        </label>
        <button class="primary full" type="submit">Đồng ý và tiếp tục</button>
        <p class="error" ${error ? "" : "hidden"}>${escapeHtml(error)}</p>
      </form>
    </section>`;
  document
    .getElementById("consent-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/consent", {
          method: "POST",
          body: JSON.stringify({
            accepted: true,
            version: status.consentVersion,
          }),
        });
        await boot();
      } catch (consentError) {
        showConsent(consentError.message);
      }
    });
}

function codeLabel(code) {
  return keyLabels[code] ?? code;
}

async function showNkro() {
  accountHeader();
  startTelemetry();
  const state = await api("/api/nkro");
  const round = state.rounds.findIndex(
    (_, index) => !state.passedRounds.includes(index),
  );
  if (round < 0) return boot();
  const expected = state.rounds[round];
  app.innerHTML = `
    <section class="panel narrow">
      <p class="concept">Kiểm tra NKRO · ${round + 1}/${state.rounds.length}</p>
      <h1>Bàn phím có nhận đủ các phím?</h1>
      <p class="lede">Giữ tất cả các phím dưới đây cùng lúc. Khi mọi phím sáng, thả cả cụm.</p>
      <div class="nkro-target">
        ${expected.map((code) => `<kbd data-code="${code}">${escapeHtml(codeLabel(code))}</kbd>`).join("")}
      </div>
      <p id="nkro-feedback" class="feedback waiting">Đang chờ bạn bấm…</p>
      <p class="muted">Bài luyện cần bàn phím ngoài có NKRO thật. Bàn phím chỉ báo một phần tổ hợp sẽ không thể qua bước này.</p>
    </section>`;

  stopCapture?.();
  stopCapture = captureChords(
    async ({ codes }) => {
      document
        .querySelectorAll("[data-code]")
        .forEach((key) => key.classList.remove("held"));
      const feedback = document.getElementById("nkro-feedback");
      try {
        const result = await api("/api/nkro", {
          method: "POST",
          body: JSON.stringify({ round, codes }),
        });
        if (result.passed) {
          feedback.className = "feedback success";
          feedback.textContent = "Đã nhận đủ phím. Sang tổ hợp tiếp theo…";
          queueTelemetry("nkro_passed", { round, codes });
          setTimeout(showNkro, 550);
        }
      } catch {
        feedback.className = "feedback failure";
        feedback.textContent = `Chưa đủ. Trình duyệt nhận: ${codes.map(codeLabel).join(" + ") || "không có phím"}. Thử lại và giữ phím thật đồng thời.`;
        queueTelemetry("nkro_failed", { round, codes });
      }
    },
    (held) => {
      document.querySelectorAll("[data-code]").forEach((key) => {
        key.classList.toggle("held", held.has(key.dataset.code));
      });
    },
  );
}

function serializeStroke(tokens) {
  const tokenSet = new Set(tokens);
  const hasMiddle = ["A", "O", "*", "E", "U"].some((token) =>
    tokenSet.has(token),
  );
  let stroke = "";
  let hyphen = false;
  for (let index = 0; index < strokeOrder.length; index += 1) {
    const token = strokeOrder[index];
    if (
      !hasMiddle &&
      !hyphen &&
      index >= strokeOrder.indexOf("-F") &&
      tokenSet.has(token)
    ) {
      stroke += "-";
      hyphen = true;
    }
    if (tokenSet.has(token)) stroke += token.replace("-", "");
  }
  return stroke;
}

function captureChords(onStroke, onHeld = () => {}) {
  const heldCodes = new Set();
  const chordCodes = new Set();
  let largestHeld = new Set();
  const down = (event) => {
    if (!stenoForCode[event.code] || event.repeat) return;
    event.preventDefault();
    heldCodes.add(event.code);
    chordCodes.add(event.code);
    if (heldCodes.size > largestHeld.size) largestHeld = new Set(heldCodes);
    onHeld(heldCodes);
  };
  const up = (event) => {
    if (!stenoForCode[event.code]) return;
    event.preventDefault();
    heldCodes.delete(event.code);
    onHeld(heldCodes);
    if (heldCodes.size === 0 && chordCodes.size) {
      const codes = [...largestHeld];
      const stroke = serializeStroke(
        [...chordCodes].map((code) => stenoForCode[code]),
      );
      chordCodes.clear();
      largestHeld = new Set();
      onStroke({ stroke, codes });
    }
  };
  const clear = () => {
    heldCodes.clear();
    chordCodes.clear();
    largestHeld.clear();
    onHeld(heldCodes);
  };
  document.addEventListener("keydown", down);
  document.addEventListener("keyup", up);
  window.addEventListener("blur", clear);
  return () => {
    document.removeEventListener("keydown", down);
    document.removeEventListener("keyup", up);
    window.removeEventListener("blur", clear);
  };
}

function keyboardHtml(targetKeys) {
  const rows = [
    [
      "KeyQ",
      "KeyW",
      "KeyE",
      "KeyR",
      "KeyT",
      "KeyY",
      "KeyU",
      "KeyI",
      "KeyO",
      "KeyP",
    ],
    [
      "KeyA",
      "KeyS",
      "KeyD",
      "KeyF",
      "KeyG",
      "KeyH",
      "KeyJ",
      "KeyK",
      "KeyL",
      "Semicolon",
    ],
    ["KeyC", "KeyV", "KeyN", "KeyM"],
  ];
  return `
    <div class="keyboard" aria-label="Sơ đồ bàn phím">
      ${rows
        .map(
          (row) =>
            `<div class="keyboard-row">${row
              .map(
                (code) =>
                  `<kbd data-key="${code}" class="${targetKeys.includes(code) ? "target" : ""}">${codeLabel(code)}</kbd>`,
              )
              .join("")}</div>`,
        )
        .join("")}
      <div class="keyboard-row"><kbd data-key="Space" class="space ${targetKeys.includes("Space") ? "target" : ""}">Space · *</kbd></div>
    </div>`;
}

let practiceStart = 0;
let sessionCorrect = 0;
let sessionAttempts = 0;
let currentPayload = null;
let currentStrokes = [];
let cardStartedAt = 0;
let submitting = false;
let guidedFlow = null;
let sentenceEditorText = "";
let sentenceSnapshotTimer = null;

function scoreHtml(stats) {
  const minutes = Math.max((Date.now() - practiceStart) / 60_000, 1 / 60);
  const pace = Math.round(sessionCorrect / minutes);
  return `
    <div class="score"><strong>${stats.accuracy}%</strong><span>Chính xác</span></div>
    <div class="score"><strong>${pace}</strong><span>Lượt/phút</span></div>
    <div class="score"><strong>${stats.averageSeconds}s</strong><span>Thời gian TB</span></div>
    <div class="score"><strong>${sessionCorrect}/${sessionAttempts}</strong><span>Phiên này</span></div>`;
}

function renderPractice(payload) {
  if (payload.card.kind === "sentence") {
    return renderSentencePractice(payload);
  }
  currentPayload = payload;
  currentStrokes = [];
  cardStartedAt = performance.now();
  submitting = false;
  guidedFlow =
    payload.card.kind === "inference"
      ? { phase: "island", candidates: [], selectedText: "" }
      : null;
  const { card, stats, isNew } = payload;
  const hintHidden = !isNew;
  app.innerHTML = `
    <div class="practice-shell">
      <section class="panel practice-main">
        <div class="score-strip" id="scores">${scoreHtml(stats)}</div>
        <div class="drill-stage">
          <p class="concept">${escapeHtml(card.instruction.title)} · ${isNew ? "bài mới" : "ôn lại"}</p>
          <p class="instruction">${escapeHtml(card.instruction.instruction)}</p>
          <div class="target-word">${escapeHtml(card.target)}</div>
          <div id="interactive-output"></div>
          <div class="stroke-hint">
            <span id="stroke-value" class="stroke-text" ${hintHidden ? "hidden" : ""}>${card.strokes.map(escapeHtml).join(" / ")}</span>
            <button id="show-hint" class="link-button" ${hintHidden ? "" : "hidden"}>Hiện các phím cần bấm</button>
          </div>
          ${keyboardHtml(hintHidden ? [] : card.keys)}
          ${card.note ? `<p class="note">${escapeHtml(card.note)}</p>` : ""}
          <p id="feedback" class="feedback waiting">Bấm một lần để viết “${escapeHtml(card.target)}”.</p>
        </div>
      </section>
      <aside class="panel sidebar">
        <h2>Tiến độ</h2>
        <div class="progress-track"><div class="progress-bar" style="width: ${Math.min(100, (stats.attempts / 30) * 100)}%"></div></div>
        <h2>Nhịp luyện</h2>
        <ul class="queue">
          <li>${escapeHtml(card.target)}</li>
          <li>Bài tiếp theo sẽ ôn lại chỗ bạn còn chậm</li>
          <li>Bấm sai → thử lại ngay</li>
          <li>Bấm đúng → tiếp tục không ngắt quãng</li>
        </ul>
        <button class="secondary full" id="pause">Tạm dừng</button>
      </aside>
    </div>`;
  accountHeader();
  document.getElementById("show-hint")?.addEventListener("click", () => {
    document.getElementById("show-hint").hidden = true;
    document.getElementById("stroke-value").hidden = false;
    card.keys.forEach((code) =>
      document.querySelector(`[data-key="${code}"]`)?.classList.add("target"),
    );
    queueTelemetry("hint_revealed", { cardId: card.id });
  });
  document.getElementById("pause").addEventListener("click", () => {
    stopCapture?.();
    stopCapture = null;
    document.getElementById("feedback").textContent =
      "Đã tạm dừng. Bấm tiếp tục khi sẵn sàng.";
    const button = document.getElementById("pause");
    button.textContent = "Tiếp tục";
    button.onclick = () => startPractice();
  });
  stopCapture?.();
  stopCapture = captureChords(handlePracticeStroke, (held) => {
    document.querySelectorAll("[data-key]").forEach((key) => {
      key.classList.toggle("held", held.has(key.dataset.key));
    });
  });
  queueTelemetry("card_presented", { cardId: card.id, isNew });
}

async function handlePracticeStroke({ stroke, codes }) {
  if (submitting || !currentPayload) return;
  if (currentPayload.card.kind === "inference") {
    return handleGuidedInferenceStroke({ stroke, codes });
  }
  currentStrokes.push(stroke);
  queueTelemetry("steno_stroke", {
    cardId: currentPayload.card.id,
    stroke,
    codes,
    ordinal: currentStrokes.length,
  });
  if (currentStrokes.length < currentPayload.card.strokes.length) {
    document.getElementById("feedback").textContent =
      `Đã nhận ${currentStrokes.join(" / ")} — tiếp tục lần bấm kế tiếp.`;
    return;
  }
  submitting = true;
  const latencyMs = Math.round(performance.now() - cardStartedAt);
  try {
    const result = await api("/api/drill/attempt", {
      method: "POST",
      body: JSON.stringify({
        cardId: currentPayload.card.id,
        strokes: currentStrokes,
        latencyMs,
      }),
    });
    sessionAttempts += 1;
    if (result.correct) sessionCorrect += 1;
    document.getElementById("scores").innerHTML = scoreHtml(
      result.review.stats,
    );
    const feedback = document.getElementById("feedback");
    if (result.correct) {
      feedback.className = "feedback success";
      feedback.textContent = result.resolvedText
        ? `Đúng · ${result.resolvedText}`
        : "Đúng.";
      announce(`Đúng. ${currentPayload.card.target}`);
      queueTelemetry("card_correct", {
        cardId: currentPayload.card.id,
        strokes: currentStrokes,
        latencyMs,
        fsrsRating: result.review.rating,
      });
      setTimeout(() => renderPractice(result.next), 520);
    } else {
      feedback.className = "feedback failure";
      feedback.textContent = `Bạn vừa bấm: ${currentStrokes.join(" / ")}. Hãy thử lại bằng ${result.expectedStrokes.join(" / ")}`;
      document.getElementById("stroke-value").hidden = false;
      document.getElementById("show-hint").hidden = true;
      currentPayload.card.keys.forEach((code) =>
        document.querySelector(`[data-key="${code}"]`)?.classList.add("target"),
      );
      announce("Chưa đúng. Hãy thử lại ngay.");
      queueTelemetry("card_misstroke", {
        cardId: currentPayload.card.id,
        observed: currentStrokes,
        expected: result.expectedStrokes,
        latencyMs,
      });
      currentStrokes = [];
      cardStartedAt = performance.now();
      submitting = false;
    }
  } catch (error) {
    document.getElementById("feedback").className = "feedback failure";
    document.getElementById("feedback").textContent = error.message;
    currentStrokes = [];
    submitting = false;
  }
}

function updateHint(label, keys) {
  const strokeValue = document.getElementById("stroke-value");
  const showHint = document.getElementById("show-hint");
  if (strokeValue) {
    strokeValue.hidden = false;
    strokeValue.textContent = label;
  }
  if (showHint) showHint.hidden = true;
  document.querySelectorAll("[data-key]").forEach((key) => {
    key.classList.toggle("target", keys.includes(key.dataset.key));
  });
}

function highlightedText(text, activeFromRight = null) {
  const words = [...String(text).matchAll(/[\p{L}\p{M}]+/gu)];
  if (!words.length) return escapeHtml(text);
  let html = "";
  let cursor = 0;
  words.forEach((word, index) => {
    html += escapeHtml(text.slice(cursor, word.index));
    const fromRight = words.length - index;
    const active = activeFromRight === fromRight;
    html += `<span class="numbered-word ${active ? "active-word" : ""}">${escapeHtml(word[0])}</span>`;
    cursor = word.index + word[0].length;
  });
  return html + escapeHtml(text.slice(cursor));
}

function candidateList(candidates, selectedIndex = null) {
  return `<ol class="candidate-list">${candidates
    .map(
      (candidate, index) =>
        `<li class="${index === selectedIndex ? "requested" : ""}">
          <span>${escapeHtml(candidate)}</span>
          <kbd>${["-T", "-TS", "-S", "-D", "-Z"][index] ?? "—"}</kbd>
        </li>`,
    )
    .join("")}</ol>`;
}

async function handleGuidedInferenceStroke({ stroke, codes }) {
  const card = currentPayload.card;
  const feedback = document.getElementById("feedback");
  queueTelemetry("steno_stroke", {
    cardId: card.id,
    stroke,
    codes,
    phase: guidedFlow.phase,
  });

  if (guidedFlow.phase === "island") {
    if (stroke !== card.strokes[0]) {
      feedback.className = "feedback failure";
      feedback.textContent = `Bạn vừa bấm: ${stroke}. Hãy thử lại bằng ${card.strokes[0]}`;
      updateHint(card.strokes[0], card.keys);
      return;
    }
    submitting = true;
    try {
      const result = await api("/api/drill/infer", {
        method: "POST",
        body: JSON.stringify({ cardId: card.id, stroke }),
      });
      currentStrokes.push(stroke);
      guidedFlow = {
        phase: "candidate",
        candidates: result.candidates,
        selectedIndex: result.selectedIndex,
        selectionStroke: result.selectionStroke,
        selectionKeys: result.selectionKeys,
      };
      document.getElementById("interactive-output").innerHTML = `
        <p class="phase-label">Chọn cách viết</p>
        ${candidateList(result.candidates, result.selectedIndex)}`;
      feedback.className = "feedback waiting";
      feedback.textContent = `Bấm ${result.selectionStroke} để chọn “${result.candidates[result.selectedIndex]}”.`;
      updateHint(result.selectionStroke, result.selectionKeys);
    } catch (error) {
      feedback.className = "feedback failure";
      feedback.textContent = error.message;
    } finally {
      submitting = false;
    }
    return;
  }

  if (guidedFlow.phase === "candidate") {
    if (stroke !== guidedFlow.selectionStroke) {
      feedback.className = "feedback failure";
      feedback.textContent = `Đó là ${stroke}. Hãy bấm ${guidedFlow.selectionStroke} để chọn “${guidedFlow.candidates[guidedFlow.selectedIndex]}”.`;
      return;
    }
    currentStrokes.push(stroke);
    guidedFlow.selectedText = guidedFlow.candidates[guidedFlow.selectedIndex];
    guidedFlow.phase = "piecemeal_target";
    document.getElementById("interactive-output").innerHTML = `
      <p class="phase-label">Sửa chỗ đang sáng</p>
      <div class="composed-output">${highlightedText(guidedFlow.selectedText, card.piecemeal.targetFromRight)}</div>`;
    feedback.className = "feedback waiting";
    feedback.textContent = `Kết quả chưa đúng ở chỗ đang sáng. Bấm ${card.piecemeal.entryLabel} để bắt đầu sửa chỗ đó.`;
    updateHint(card.piecemeal.entryLabel, card.piecemeal.entryKeys);
    return;
  }

  if (guidedFlow.phase === "piecemeal_target") {
    if (stroke !== card.piecemeal.entryStroke) {
      feedback.className = "feedback failure";
      feedback.textContent = `Chưa chọn đúng chỗ. Hãy bấm ${card.piecemeal.entryLabel}.`;
      return;
    }
    currentStrokes.push(stroke);
    guidedFlow.phase = "piecemeal_replace";
    feedback.className = "feedback waiting";
    feedback.textContent = `Bây giờ gõ “${card.piecemeal.replacementTarget}” để thay phần đang sáng.`;
    updateHint(
      card.piecemeal.replacementStroke,
      card.piecemeal.replacementKeys,
    );
    return;
  }

  if (guidedFlow.phase === "piecemeal_replace") {
    if (stroke !== card.piecemeal.replacementStroke) {
      feedback.className = "feedback failure";
      feedback.textContent = `Đó là ${stroke}. Để viết “${card.piecemeal.replacementTarget}”, hãy bấm ${card.piecemeal.replacementStroke}.`;
      return;
    }
    currentStrokes.push(stroke);
    return submitGuidedInference();
  }
}

async function submitGuidedInference() {
  submitting = true;
  const latencyMs = Math.round(performance.now() - cardStartedAt);
  const feedback = document.getElementById("feedback");
  try {
    const result = await api("/api/drill/attempt", {
      method: "POST",
      body: JSON.stringify({
        cardId: currentPayload.card.id,
        strokes: currentStrokes,
        latencyMs,
      }),
    });
    sessionAttempts += 1;
    if (result.correct) sessionCorrect += 1;
    document.getElementById("scores").innerHTML = scoreHtml(
      result.review.stats,
    );
    if (!result.correct)
      throw new Error(
        "Chuỗi thao tác chưa đúng; hãy làm lại từ lần bấm đầu tiên.",
      );
    feedback.className = "feedback success";
    feedback.textContent = `Đã chọn cách viết và sửa riêng chỗ chưa đúng · ${result.resolvedText}`;
    announce("Đã hoàn tất bài chọn và sửa chữ.");
    queueTelemetry("guided_inference_complete", {
      cardId: currentPayload.card.id,
      strokes: currentStrokes,
      latencyMs,
    });
    setTimeout(() => renderPractice(result.next), 850);
  } catch (error) {
    feedback.className = "feedback failure";
    feedback.textContent = error.message;
    submitting = false;
  }
}

function renderSentencePractice(payload) {
  currentPayload = payload;
  currentStrokes = [];
  sentenceEditorText = "";
  cardStartedAt = performance.now();
  submitting = false;
  const { card, stats } = payload;
  const firstPair = card.pairs[0];
  app.innerHTML = `
    <div class="practice-shell">
      <section class="panel practice-main">
        <div class="score-strip" id="scores">${scoreHtml(stats)}</div>
        <div class="drill-stage sentence-stage">
          <p class="concept">${escapeHtml(card.category)} · luyện câu tự do</p>
          <p class="instruction">${escapeHtml(card.note)}</p>
          <div class="sentence-target">${escapeHtml(card.target)}</div>
          <div class="stroke-hint">
            <span id="stroke-value" class="stroke-text">${escapeHtml(firstPair?.stroke ?? "")}</span>
            <button id="show-hint" class="link-button" hidden>Hiện gợi ý</button>
          </div>
          <iframe
            id="sentence-editor"
            class="sentence-editor"
            src="/webui/index.html?trainer-embedded=1"
            title="Trình soạn V7 đầy đủ"
          ></iframe>
          <p id="feedback" class="feedback waiting">Bạn có thể bắt đầu bằng “${escapeHtml(firstPair?.words ?? "")}” trong một lần bấm, hoặc tự gõ theo cách quen.</p>
        </div>
      </section>
      <aside class="panel sidebar">
        <h2>Cách thao tác</h2>
        <ul class="queue">
          <li>Gõ từng tiếng: không dùng Space</li>
          <li>Gõ hai tiếng một lượt: bấm thêm Space</li>
          <li>Khi có nhiều cách viết: dùng -T, -TS, -S, -D hoặc -Z để chọn dòng</li>
          <li>Chỉ sửa chỗ sai: chọn chỗ bằng T-, P-, H-, TK-… rồi gõ lại</li>
          <li>Quay lại lần bấm trước: bấm * riêng</li>
        </ul>
        <button class="secondary full" id="pause">Tạm dừng</button>
      </aside>
    </div>`;
  accountHeader();
  stopCapture?.();
  stopCapture = null;
  const frame = document.getElementById("sentence-editor");
  frame.addEventListener("load", () => attachProductionEditor(frame));
  document.getElementById("pause").addEventListener("click", (event) => {
    const paused = frame.classList.toggle("paused");
    event.currentTarget.textContent = paused ? "Tiếp tục" : "Tạm dừng";
    document.getElementById("feedback").textContent = paused
      ? "Đã tạm dừng."
      : "Tiếp tục viết câu trong trình soạn thật.";
    if (!paused) frame.contentWindow?.focus();
  });
  queueTelemetry("sentence_presented", {
    cardId: card.id,
    category: card.category,
  });
}

function comparableWords(value) {
  return (
    String(value)
      .normalize("NFC")
      .toLocaleLowerCase("vi")
      .match(/[\p{L}\p{M}]+/gu) ?? []
  ).join(" ");
}

function updateSentenceHint(text) {
  const words = String(text).match(/[\p{L}\p{M}]+/gu)?.length ?? 0;
  const pair = currentPayload.card.pairs[Math.floor(words / 2)];
  const hint = document.getElementById("stroke-value");
  if (pair) {
    hint.textContent = `${pair.words} · ${pair.stroke}`;
    document.getElementById("feedback").textContent =
      `Một cách nhanh để viết “${pair.words}” là bấm ${pair.stroke}. Bạn vẫn có thể gõ từng tiếng.`;
  } else {
    hint.textContent = "Tự hoàn tất phần còn lại";
  }
}

function snapshotEditorFrame(frame) {
  const documentClone = frame.contentDocument?.documentElement.cloneNode(true);
  if (!documentClone) return;
  documentClone.querySelectorAll("script").forEach((node) => node.remove());
  queueTelemetry("editor_dom_snapshot", {
    html: documentClone.outerHTML.slice(0, 280_000),
    viewport: {
      width: frame.contentWindow.innerWidth,
      height: frame.contentWindow.innerHeight,
      devicePixelRatio: frame.contentWindow.devicePixelRatio,
    },
  });
}

function attachProductionEditor(frame) {
  const editorWindow = frame.contentWindow;
  const editorDocument = frame.contentDocument;
  if (!editorWindow || !editorDocument) return;
  editorWindow.addEventListener("v7-editor-stroke", (event) => {
    const stroke = event.detail?.stroke ?? "";
    currentStrokes.push(stroke);
    queueTelemetry("sentence_editor_stroke", {
      cardId: currentPayload.card.id,
      stroke,
    });
  });
  editorWindow.addEventListener("v7-editor-state", (event) => {
    const detail = event.detail ?? {};
    sentenceEditorText = String(detail.text ?? "");
    if ((detail.candidates?.length ?? 0) > 0) {
      document.getElementById("feedback").textContent =
        "Hệ thống đang đưa ra vài cách viết. Nếu chưa đúng, hãy chọn một dòng hoặc chỉ sửa chỗ sai.";
    } else {
      updateSentenceHint(sentenceEditorText);
    }
    queueTelemetry("sentence_editor_state", {
      cardId: currentPayload.card.id,
      text: sentenceEditorText,
      candidates: detail.candidates ?? [],
      piecemealCursorIndex: detail.piecemealCursorIndex,
      inferencePending: detail.inferencePending,
      inferenceError: detail.inferenceError,
    });
    if (
      !submitting &&
      (detail.candidates?.length ?? 0) === 0 &&
      comparableWords(sentenceEditorText) ===
        comparableWords(currentPayload.card.target)
    ) {
      void completeSentence(sentenceEditorText);
    }
  });
  let lastPointer = 0;
  editorDocument.addEventListener("keydown", (event) =>
    queueTelemetry("editor_keydown", {
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      target: event.target?.id || event.target?.tagName,
    }),
  );
  editorDocument.addEventListener("keyup", (event) =>
    queueTelemetry("editor_keyup", {
      key: event.key,
      code: event.code,
      target: event.target?.id || event.target?.tagName,
    }),
  );
  editorDocument.addEventListener("pointermove", (event) => {
    if (performance.now() - lastPointer < 100) return;
    lastPointer = performance.now();
    queueTelemetry("editor_pointermove", {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
    });
  });
  editorDocument.addEventListener("click", (event) =>
    queueTelemetry("editor_click", {
      x: event.clientX,
      y: event.clientY,
      target: event.target?.id || event.target?.tagName,
    }),
  );
  clearInterval(sentenceSnapshotTimer);
  sentenceSnapshotTimer = setInterval(() => snapshotEditorFrame(frame), 30_000);
  queueMicrotask(() => snapshotEditorFrame(frame));
  editorWindow.focus();
}

async function completeSentence(resolvedText) {
  submitting = true;
  const latencyMs = Math.round(performance.now() - cardStartedAt);
  const feedback = document.getElementById("feedback");
  try {
    const result = await api("/api/sentence/complete", {
      method: "POST",
      body: JSON.stringify({
        cardId: currentPayload.card.id,
        resolvedText,
        strokes: currentStrokes,
        latencyMs,
      }),
    });
    sessionAttempts += 1;
    sessionCorrect += 1;
    document.getElementById("scores").innerHTML = scoreHtml(
      result.review.stats,
    );
    feedback.className = "feedback success";
    feedback.textContent =
      "Hoàn thành câu. Bài sau sẽ dựa vào tốc độ và những chỗ bạn còn vướng.";
    announce("Hoàn thành câu.");
    queueTelemetry("sentence_complete", {
      cardId: currentPayload.card.id,
      strokes: currentStrokes.length,
      latencyMs,
    });
    setTimeout(() => renderPractice(result.next), 1000);
  } catch (error) {
    submitting = false;
    feedback.className = "feedback failure";
    feedback.textContent = error.message;
  }
}

async function startPractice() {
  startTelemetry();
  if (!practiceStart) practiceStart = Date.now();
  const payload = await api("/api/drill/next");
  renderPractice(payload);
}

function queueTelemetry(type, payload = {}) {
  if (!telemetryStarted) return;
  eventQueue.push({
    sequence: ++sequence,
    type,
    occurredAt: Date.now(),
    path: location.pathname,
    viewport: { width: innerWidth, height: innerHeight },
    payload,
  });
  if (eventQueue.length >= 40) flushTelemetry();
}

async function flushTelemetry() {
  if (!telemetryStarted || !eventQueue.length) return;
  const events = eventQueue.splice(0, 250);
  try {
    await api("/api/events", {
      method: "POST",
      body: JSON.stringify({ events }),
    });
  } catch {
    eventQueue.unshift(...events);
  }
}

function domSnapshot() {
  const clone = document.documentElement.cloneNode(true);
  clone
    .querySelectorAll('input[type="password"], script')
    .forEach((node) => node.remove());
  clone
    .querySelectorAll("input, textarea")
    .forEach((node) => node.removeAttribute("value"));
  queueTelemetry("dom_snapshot", {
    html: clone.outerHTML.slice(0, 280_000),
    scrollX,
    scrollY,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  });
}

function startTelemetry() {
  if (telemetryStarted) return;
  telemetryStarted = true;
  let lastPointer = 0;
  document.addEventListener("keydown", (event) =>
    queueTelemetry("keydown", {
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      target: event.target?.id || event.target?.tagName,
    }),
  );
  document.addEventListener("keyup", (event) =>
    queueTelemetry("keyup", {
      key: event.key,
      code: event.code,
      alt: event.altKey,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      meta: event.metaKey,
      target: event.target?.id || event.target?.tagName,
    }),
  );
  document.addEventListener("pointermove", (event) => {
    if (performance.now() - lastPointer < 100) return;
    lastPointer = performance.now();
    queueTelemetry("pointermove", {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
    });
  });
  document.addEventListener("click", (event) =>
    queueTelemetry("click", {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      target: event.target?.id || event.target?.tagName,
      text: event.target?.textContent?.trim().slice(0, 120) ?? "",
    }),
  );
  window.addEventListener("resize", () =>
    queueTelemetry("viewport", {
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
    }),
  );
  eventTimer = setInterval(flushTelemetry, 2000);
  setInterval(domSnapshot, 30_000);
  queueMicrotask(domSnapshot);
}

async function boot() {
  stopCapture?.();
  stopCapture = null;
  status = await api("/api/status");
  if (!status.authenticated) return showLogin();
  if (!status.consented) return showConsent();
  startTelemetry();
  if (!status.enrolled) return showNkro();
  return startPractice();
}

window.addEventListener("pagehide", () => {
  if (!telemetryStarted || !eventQueue.length) return;
  navigator.sendBeacon(
    "/api/events",
    new Blob([JSON.stringify({ events: eventQueue.splice(0, 250) })], {
      type: "application/json",
    }),
  );
});

boot().catch((error) => {
  app.innerHTML = `<section class="panel narrow"><h1>Không mở được phòng luyện</h1><p class="error">${escapeHtml(error.message)}</p></section>`;
});
