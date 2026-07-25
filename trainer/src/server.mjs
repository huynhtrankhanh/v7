import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_VERSION, NKRO_ROUNDS, TrainerDatabase } from "./database.mjs";
import { getCard } from "./drills.mjs";

const moduleDirectory = fileURLToPath(new URL(".", import.meta.url));
const publicDirectory = normalize(join(moduleDirectory, "..", "public"));

const json = (response, status, body, extraHeaders = {}) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
};

const parseCookies = (request) =>
  Object.fromEntries(
    String(request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, value]) => [name, decodeURIComponent(value)]),
  );

const readJson = async (request, limit = 4_000_000) => {
  if (
    !String(request.headers["content-type"] ?? "").startsWith(
      "application/json",
    )
  ) {
    throw Object.assign(new Error("Yêu cầu phải dùng application/json."), {
      status: 415,
    });
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) {
      throw Object.assign(new Error("Yêu cầu quá lớn."), { status: 413 });
    }
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw Object.assign(new Error("JSON không hợp lệ."), { status: 400 });
  }
};

const comparableWords = (value) =>
  (
    String(value)
      .normalize("NFC")
      .toLocaleLowerCase("vi")
      .match(/[\p{L}\p{M}]+/gu) ?? []
  ).join(" ");

const selectionStrokes = ["-T", "-TS", "-S", "-D", "-Z"];
const selectionKeys = [
  ["KeyP"],
  ["KeyP", "Semicolon"],
  ["Semicolon"],
  ["KeyT"],
  ["KeyY"],
];
function replaceWordFromRight(text, ordinal, replacement) {
  const matches = [...String(text).matchAll(/[\p{L}\p{M}]+/gu)];
  const target = matches[matches.length - ordinal];
  if (!target) return null;
  return `${text.slice(0, target.index)}${replacement}${text.slice(target.index + target[0].length)}`;
}

export function createTrainerServer(options = {}) {
  const database =
    options.database ??
    new TrainerDatabase(
      options.databasePath ??
        process.env.V7_TRAINER_DB ??
        "./data/trainer.sqlite3",
    );
  const inferenceUrl =
    options.inferenceUrl ??
    process.env.V7_INFERENCE_URL ??
    "http://127.0.0.1:3000/infer";
  const webuiDirectory = normalize(
    options.webuiDirectory ??
      process.env.V7_WEBUI_DIR ??
      join(moduleDirectory, "..", "..", "static"),
  );
  const publicOrigin =
    options.publicOrigin ?? process.env.V7_TRAINER_ORIGIN ?? "";
  const secureCookie =
    options.secureCookie ?? process.env.V7_TRAINER_SECURE_COOKIE === "1";
  const loginAttempts = new Map();

  const sessionCookie = (token, maxAge = 30 * 24 * 60 * 60) =>
    `v7_trainer_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${
      secureCookie ? "; Secure" : ""
    }`;

  const userFor = (request) =>
    database.userForToken(parseCookies(request).v7_trainer_session);

  const requireUser = (
    request,
    response,
    { consent = false, enrolled = false } = {},
  ) => {
    const user = userFor(request);
    if (!user) {
      json(response, 401, { error: "Hãy đăng nhập." });
      return null;
    }
    if (consent && user.consent_version !== CONSENT_VERSION) {
      json(response, 403, { error: "Cần đồng ý thu thập dữ liệu trước." });
      return null;
    }
    if (enrolled && !user.enrolled_at) {
      json(response, 403, { error: "Cần hoàn tất kiểm tra NKRO trước." });
      return null;
    }
    return user;
  };

  const validateOrigin = (request, response) => {
    if (!publicOrigin) return true;
    const origin = request.headers.origin;
    if (origin === publicOrigin) return true;
    json(response, 403, { error: "Nguồn yêu cầu không hợp lệ." });
    return false;
  };

  const runInference = async (islands) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const result = await fetch(inferenceUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ islands }),
        signal: controller.signal,
      });
      if (!result.ok) throw new Error(`inference trả về HTTP ${result.status}`);
      const payload = await result.json();
      return Array.isArray(payload.candidates) ? payload.candidates : [];
    } finally {
      clearTimeout(timeout);
    }
  };

  const handleApi = async (request, response, url) => {
    if (request.method !== "GET" && !validateOrigin(request, response)) return;

    if (request.method === "GET" && url.pathname === "/api/status") {
      return json(response, 200, {
        ...database.status(userFor(request)),
        consentVersion: CONSENT_VERSION,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/login") {
      const key = request.socket.remoteAddress ?? "unknown";
      const recent = (loginAttempts.get(key) ?? []).filter(
        (time) => Date.now() - time < 60_000,
      );
      if (recent.length >= 8)
        return json(response, 429, { error: "Thử lại sau một phút." });
      recent.push(Date.now());
      loginAttempts.set(key, recent);
      const body = await readJson(request, 20_000);
      const token = await database.login(body.username, body.password);
      if (!token)
        return json(response, 401, {
          error: "Tên tài khoản hoặc mật khẩu không đúng.",
        });
      loginAttempts.delete(key);
      return json(
        response,
        200,
        database.status(database.userForToken(token)),
        { "set-cookie": sessionCookie(token) },
      );
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
      const token = parseCookies(request).v7_trainer_session;
      database.logout(token);
      return json(
        response,
        200,
        { ok: true },
        { "set-cookie": sessionCookie("", 0) },
      );
    }

    if (request.method === "POST" && url.pathname === "/api/consent") {
      const user = requireUser(request, response);
      if (!user) return;
      const body = await readJson(request);
      if (body.accepted !== true || body.version !== CONSENT_VERSION) {
        return json(response, 400, {
          error: "Cần xác nhận rõ ràng tất cả mục thu thập.",
        });
      }
      database.acceptConsent(user.id, body.version);
      return json(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/nkro") {
      const user = requireUser(request, response, { consent: true });
      if (!user) return;
      return json(response, 200, {
        rounds: NKRO_ROUNDS,
        passedRounds: database.status(user).nkroPassedRounds,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/nkro") {
      const user = requireUser(request, response, { consent: true });
      if (!user) return;
      const body = await readJson(request);
      const passed = database.recordNkroRound(user.id, body.round, body.codes);
      return json(response, passed ? 200 : 422, {
        passed,
        status: database.status(userFor(request)),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/drill/next") {
      const user = requireUser(request, response, {
        consent: true,
        enrolled: true,
      });
      if (!user) return;
      return json(
        response,
        200,
        database.nextCard(user.id, url.searchParams.get("exclude") ?? ""),
      );
    }

    if (request.method === "POST" && url.pathname === "/api/drill/infer") {
      const user = requireUser(request, response, {
        consent: true,
        enrolled: true,
      });
      if (!user) return;
      const body = await readJson(request);
      const item = getCard(body.cardId);
      if (
        !item ||
        item.kind !== "inference" ||
        body.stroke !== item.strokes[0]
      ) {
        return json(response, 422, {
          error: "Lần bấm V7 chưa đúng; hãy thử lại để xem các cách viết.",
        });
      }
      try {
        const rawCandidates = await runInference(item.islands);
        const candidates = rawCandidates.map((parts) =>
          Array.isArray(parts) ? parts.join("") : String(parts),
        );
        const selectedIndex = Math.min(
          item.selectionIndex ?? 0,
          candidates.length - 1,
        );
        if (selectedIndex < 0)
          throw new Error("hệ thống không đưa ra cách viết nào");
        return json(response, 200, {
          candidates: candidates.slice(0, 5),
          selectedIndex,
          selectionStroke: selectionStrokes[selectedIndex],
          selectionKeys: selectionKeys[selectedIndex],
        });
      } catch (error) {
        console.error("Trainer inference request failed", error);
        return json(response, 502, {
          error: "Hệ thống chưa đưa ra được các cách viết. Hãy thử lại sau.",
        });
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/sentence/complete"
    ) {
      const user = requireUser(request, response, {
        consent: true,
        enrolled: true,
      });
      if (!user) return;
      const body = await readJson(request);
      const item = getCard(body.cardId);
      const correct =
        item?.kind === "sentence" &&
        comparableWords(body.resolvedText) === comparableWords(item.target);
      if (!correct)
        return json(response, 422, { error: "Câu chưa khớp mục tiêu." });
      const review = database.saveAttempt(user.id, {
        cardId: item.id,
        observedStrokes: Array.isArray(body.strokes)
          ? body.strokes.slice(0, 200)
          : [],
        resolvedText: body.resolvedText,
        correct: true,
        latencyMs: body.latencyMs,
      });
      return json(response, 200, {
        correct: true,
        review,
        next: database.nextCard(user.id, item.id),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/drill/attempt") {
      const user = requireUser(request, response, {
        consent: true,
        enrolled: true,
      });
      if (!user) return;
      const body = await readJson(request);
      const item = getCard(body.cardId);
      if (!item || !Array.isArray(body.strokes) || body.strokes.length > 8) {
        return json(response, 400, { error: "Lượt luyện không hợp lệ." });
      }
      const observed = body.strokes.map(String);
      const strokeCorrect =
        observed.length === item.strokes.length &&
        observed.every((stroke, index) => stroke === item.strokes[index]);
      let resolvedText =
        strokeCorrect && item.kind === "deterministic" ? item.target : "";
      let candidates = [];
      let correct = strokeCorrect;
      if (item.kind === "inference") {
        const expectedSelection = selectionStrokes[item.selectionIndex ?? 0];
        const expected = [
          item.strokes[0],
          expectedSelection,
          item.piecemeal.entryStroke,
          item.piecemeal.replacementStroke,
        ];
        correct =
          observed.length === expected.length &&
          observed.every((stroke, index) => stroke === expected[index]);
      }
      if (correct && item.kind === "inference") {
        try {
          candidates = await runInference(item.islands);
        } catch (error) {
          console.error("Trainer inference request failed", error);
          return json(response, 502, {
            error: "Hệ thống chưa đưa ra được các cách viết. Hãy thử lại sau.",
          });
        }
        const texts = candidates.map((parts) =>
          Array.isArray(parts) ? parts.join("") : "",
        );
        const selected =
          texts[Math.min(item.selectionIndex ?? 0, texts.length - 1)] ?? "";
        resolvedText =
          replaceWordFromRight(
            selected,
            item.piecemeal.targetFromRight,
            item.piecemeal.replacementTarget,
          ) ?? "";
      }
      const review = database.saveAttempt(user.id, {
        cardId: item.id,
        observedStrokes: observed,
        resolvedText,
        correct,
        latencyMs: body.latencyMs,
      });
      return json(response, 200, {
        correct,
        expectedStrokes: item.strokes,
        observedStrokes: observed,
        resolvedText,
        candidates: candidates.slice(0, 5),
        review,
        next: correct
          ? database.nextCard(user.id, item.id)
          : database.nextCard(user.id),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/events") {
      const user = requireUser(request, response, { consent: true });
      if (!user) return;
      const body = await readJson(request);
      database.recordEvents(user.id, body.events);
      return json(response, 202, { accepted: body.events.length });
    }

    return json(response, 404, { error: "Không tìm thấy API." });
  };

  const serveStatic = async (request, response, url) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(response, 405, { error: "Phương thức không được hỗ trợ." });
    }
    const requestPath =
      url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = join(publicDirectory, safePath);
    if (!filePath.startsWith(publicDirectory))
      return json(response, 404, { error: "Không tìm thấy." });
    try {
      const body = await readFile(filePath);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
      };
      response.writeHead(200, {
        "content-type": types[extname(filePath)] ?? "application/octet-stream",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "cache-control":
          extname(filePath) === ".html" ? "no-store" : "public, max-age=3600",
      });
      if (request.method === "HEAD") response.end();
      else response.end(body);
    } catch (error) {
      if (error.code === "ENOENT")
        return json(response, 404, { error: "Không tìm thấy." });
      throw error;
    }
  };

  const serveWebui = async (request, response, url) => {
    const user = requireUser(request, response, {
      consent: true,
      enrolled: true,
    });
    if (!user) return;
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(response, 405, { error: "Phương thức không được hỗ trợ." });
    }
    const requestPath =
      url.pathname === "/webui" || url.pathname === "/webui/"
        ? "index.html"
        : url.pathname.slice("/webui/".length);
    const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath = join(webuiDirectory, safePath);
    if (!filePath.startsWith(webuiDirectory)) {
      return json(response, 404, { error: "Không tìm thấy WebUI." });
    }
    try {
      const body = await readFile(filePath);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
      };
      response.writeHead(200, {
        "content-type": types[extname(filePath)] ?? "application/octet-stream",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
        "cache-control": "no-store",
      });
      if (request.method === "HEAD") response.end();
      else response.end(body);
    } catch (error) {
      if (error.code === "ENOENT") {
        return json(response, 404, {
          error: "WebUI chưa được build. Chạy npm run build ở thư mục gốc.",
        });
      }
      throw error;
    }
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://trainer.local");
      if (request.method === "POST" && url.pathname === "/infer") {
        const user = requireUser(request, response, {
          consent: true,
          enrolled: true,
        });
        if (!user) return;
        const body = await readJson(request);
        const candidates = await runInference(body.islands);
        return json(response, 200, { candidates });
      }
      if (request.method === "GET" && url.pathname === "/plover/status") {
        return json(response, 200, { available: false });
      }
      if (url.pathname === "/webui" || url.pathname.startsWith("/webui/")) {
        await serveWebui(request, response, url);
      } else if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
      } else await serveStatic(request, response, url);
    } catch (error) {
      json(response, error.status ?? 500, {
        error: error.status
          ? error.message
          : "Lỗi nội bộ của hệ thống học tập.",
      });
    }
  });

  server.trainerDatabase = database;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "0.0.0.0";
  const server = createTrainerServer();
  server.listen(port, host, () => {
    console.log(`V7 IME Trainer đang nghe tại http://${host}:${port}`);
  });
}
