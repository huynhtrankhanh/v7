import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cards, getCard, publicCard } from "./drills.mjs";
import { scheduleReview } from "./fsrs.mjs";
import {
  hashPassword,
  newSessionToken,
  tokenDigest,
  verifyPassword,
} from "./security.mjs";

const DAY_MS = 86_400_000;
export const CONSENT_VERSION = "2026-07-25";
export const NKRO_ROUNDS = [
  ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyA"],
  ["KeyU", "KeyI", "KeyO", "KeyP", "Semicolon"],
  ["KeyA", "KeyS", "KeyD", "KeyF", "KeyJ", "KeyK", "KeyL", "Semicolon"],
];

const sameSet = (left, right) => {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
};

export class TrainerDatabase {
  constructor(databasePath) {
    const finalPath =
      databasePath === ":memory:" ? databasePath : resolve(databasePath);
    if (finalPath !== ":memory:")
      mkdirSync(dirname(finalPath), { recursive: true });
    this.db = new DatabaseSync(finalPath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        disabled_at INTEGER,
        consent_version TEXT,
        consented_at INTEGER,
        enrolled_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_digest TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nkro_checks (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        round INTEGER NOT NULL,
        observed_codes_json TEXT NOT NULL,
        passed_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, round)
      );
      CREATE TABLE IF NOT EXISTS card_reviews (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL,
        stability REAL NOT NULL,
        difficulty REAL NOT NULL,
        repetitions INTEGER NOT NULL,
        lapses INTEGER NOT NULL,
        last_reviewed_at INTEGER NOT NULL,
        due_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, card_id)
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        card_id TEXT NOT NULL,
        expected_text TEXT NOT NULL,
        observed_strokes_json TEXT NOT NULL,
        resolved_text TEXT NOT NULL,
        correct INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        fsrs_rating INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        page_path TEXT NOT NULL,
        viewport_width INTEGER,
        viewport_height INTEGER,
        payload_json TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        UNIQUE(user_id, client_sequence)
      );
      CREATE INDEX IF NOT EXISTS card_reviews_due
        ON card_reviews(user_id, due_at);
      CREATE INDEX IF NOT EXISTS telemetry_user_time
        ON telemetry_events(user_id, occurred_at);
    `);
  }

  close() {
    this.db.close();
  }

  async createUser(username, password) {
    const cleanName = String(username).trim();
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(cleanName)) {
      throw new Error(
        "Tên tài khoản phải dài 3–64 ký tự và chỉ dùng chữ, số, _, . hoặc -.",
      );
    }
    const passwordHash = await hashPassword(password);
    this.db
      .prepare(
        `INSERT INTO users(username, password_hash, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(cleanName, passwordHash, Date.now());
  }

  listUsers() {
    return this.db
      .prepare(
        `SELECT username, created_at, disabled_at, consented_at, enrolled_at
         FROM users ORDER BY username`,
      )
      .all();
  }

  disableUser(username) {
    const result = this.db
      .prepare("UPDATE users SET disabled_at = ? WHERE username = ?")
      .run(Date.now(), String(username).trim());
    if (result.changes === 0) throw new Error("Không tìm thấy tài khoản.");
    this.db
      .prepare(
        "DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)",
      )
      .run(String(username).trim());
  }

  async login(username, password) {
    const user = this.db
      .prepare(
        `SELECT id, username, password_hash, disabled_at
         FROM users WHERE username = ?`,
      )
      .get(String(username).trim());
    if (
      !user ||
      user.disabled_at ||
      !(await verifyPassword(password, user.password_hash))
    ) {
      return null;
    }
    const token = newSessionToken();
    const now = Date.now();
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    this.db
      .prepare(
        `INSERT INTO sessions(token_digest, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(tokenDigest(token), user.id, now + 30 * DAY_MS, now);
    return token;
  }

  logout(token) {
    if (token) {
      this.db
        .prepare("DELETE FROM sessions WHERE token_digest = ?")
        .run(tokenDigest(token));
    }
  }

  userForToken(token) {
    if (!token) return null;
    return (
      this.db
        .prepare(
          `SELECT u.id, u.username, u.consent_version, u.consented_at, u.enrolled_at
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_digest = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
        )
        .get(tokenDigest(token), Date.now()) ?? null
    );
  }

  status(user) {
    if (!user) return { authenticated: false };
    const passed = this.db
      .prepare("SELECT round FROM nkro_checks WHERE user_id = ? ORDER BY round")
      .all(user.id)
      .map((row) => row.round);
    return {
      authenticated: true,
      username: user.username,
      consented: user.consent_version === CONSENT_VERSION,
      enrolled: Boolean(user.enrolled_at),
      nkroPassedRounds: passed,
      nkroTotalRounds: NKRO_ROUNDS.length,
    };
  }

  acceptConsent(userId, version) {
    if (version !== CONSENT_VERSION)
      throw new Error("Phiên bản đồng ý không hợp lệ.");
    this.db
      .prepare(
        `UPDATE users SET consent_version = ?, consented_at = ?, enrolled_at = NULL
         WHERE id = ?`,
      )
      .run(version, Date.now(), userId);
  }

  recordNkroRound(userId, round, observedCodes) {
    if (!Number.isInteger(round) || !NKRO_ROUNDS[round]) {
      throw new Error("Vòng kiểm tra NKRO không hợp lệ.");
    }
    if (
      !Array.isArray(observedCodes) ||
      !sameSet(observedCodes, NKRO_ROUNDS[round])
    ) {
      return false;
    }
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO nkro_checks(user_id, round, observed_codes_json, passed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, round) DO UPDATE SET
           observed_codes_json = excluded.observed_codes_json,
           passed_at = excluded.passed_at`,
      )
      .run(userId, round, JSON.stringify([...new Set(observedCodes)]), now);
    const count = this.db
      .prepare("SELECT COUNT(*) AS count FROM nkro_checks WHERE user_id = ?")
      .get(userId).count;
    if (count === NKRO_ROUNDS.length) {
      this.db
        .prepare(
          "UPDATE users SET enrolled_at = COALESCE(enrolled_at, ?) WHERE id = ?",
        )
        .run(now, userId);
    }
    return true;
  }

  nextCard(userId, excludeId = "") {
    const reviewRows = this.db
      .prepare(
        `SELECT card_id, stability, difficulty, repetitions, lapses,
                last_reviewed_at, due_at
         FROM card_reviews WHERE user_id = ?`,
      )
      .all(userId);
    const reviews = new Map(reviewRows.map((row) => [row.card_id, row]));
    const now = Date.now();
    const unseen = cards.find(
      (item) => !reviews.has(item.id) && item.id !== excludeId,
    );
    const candidates = cards
      .filter((item) => item.id !== excludeId && reviews.has(item.id))
      .sort((a, b) => reviews.get(a.id).due_at - reviews.get(b.id).due_at);
    const due = candidates.find((item) => reviews.get(item.id).due_at <= now);
    const selected = due ?? unseen ?? candidates[0] ?? cards[0];
    const review = reviews.get(selected.id);
    return {
      card: publicCard(selected),
      dueAt: review?.due_at ?? now,
      isNew: !review,
      stats: this.practiceStats(userId),
    };
  }

  reviewFor(userId, cardId) {
    const row = this.db
      .prepare(
        `SELECT stability, difficulty, repetitions, lapses,
                last_reviewed_at AS lastReviewedAt, due_at AS dueAt
         FROM card_reviews WHERE user_id = ? AND card_id = ?`,
      )
      .get(userId, cardId);
    return row ?? null;
  }

  saveAttempt(
    userId,
    { cardId, observedStrokes, resolvedText, correct, latencyMs },
  ) {
    const item = getCard(cardId);
    if (!item) throw new Error("Bài luyện không tồn tại.");
    const boundedLatency = Math.max(
      0,
      Math.min(Number(latencyMs) || 0, 600_000),
    );
    const previous = this.reviewFor(userId, cardId);
    const rating = !correct
      ? 1
      : boundedLatency <= 2500
        ? 4
        : boundedLatency <= 7000
          ? 3
          : 2;
    const next = scheduleReview(previous, rating);
    const now = Date.now();

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO attempts(
             user_id, card_id, expected_text, observed_strokes_json,
             resolved_text, correct, latency_ms, fsrs_rating, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          item.id,
          item.target,
          JSON.stringify(observedStrokes),
          resolvedText,
          correct ? 1 : 0,
          boundedLatency,
          rating,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO card_reviews(
             user_id, card_id, stability, difficulty, repetitions, lapses,
             last_reviewed_at, due_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, card_id) DO UPDATE SET
             stability = excluded.stability,
             difficulty = excluded.difficulty,
             repetitions = excluded.repetitions,
             lapses = excluded.lapses,
             last_reviewed_at = excluded.last_reviewed_at,
             due_at = excluded.due_at`,
        )
        .run(
          userId,
          item.id,
          next.stability,
          next.difficulty,
          next.repetitions,
          next.lapses,
          next.lastReviewedAt,
          next.dueAt,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return { rating, dueAt: next.dueAt, stats: this.practiceStats(userId) };
  }

  practiceStats(userId) {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS attempts,
                COALESCE(SUM(correct), 0) AS correct,
                COALESCE(SUM(CASE WHEN correct = 1 THEN latency_ms ELSE 0 END), 0)
                  AS correct_latency
         FROM attempts WHERE user_id = ?`,
      )
      .get(userId);
    const correct = Number(row.correct);
    return {
      attempts: Number(row.attempts),
      accuracy: row.attempts
        ? Math.round((correct / Number(row.attempts)) * 1000) / 10
        : 0,
      averageSeconds: correct
        ? Math.round(Number(row.correct_latency) / correct / 100) / 10
        : 0,
    };
  }

  recordEvents(userId, events) {
    if (!Array.isArray(events) || events.length > 250) {
      throw new Error("Lô sự kiện không hợp lệ.");
    }
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO telemetry_events(
         user_id, client_sequence, event_type, occurred_at, page_path,
         viewport_width, viewport_height, payload_json, received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const receivedAt = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const event of events) {
        const payload = JSON.stringify(event.payload ?? {});
        if (payload.length > 300_000)
          throw new Error("Sự kiện vượt quá giới hạn.");
        insert.run(
          userId,
          Number(event.sequence),
          String(event.type).slice(0, 64),
          Number(event.occurredAt) || receivedAt,
          String(event.path || "/").slice(0, 512),
          Number(event.viewport?.width) || null,
          Number(event.viewport?.height) || null,
          payload,
          receivedAt,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
