import assert from "node:assert/strict";
import test from "node:test";
import { scheduleReview } from "../src/fsrs.mjs";

test("new-card ratings produce ordered stability", () => {
  const now = 1_700_000_000_000;
  const again = scheduleReview(null, 1, now);
  const hard = scheduleReview(null, 2, now);
  const good = scheduleReview(null, 3, now);
  const easy = scheduleReview(null, 4, now);
  assert.ok(again.stability < hard.stability);
  assert.ok(hard.stability < good.stability);
  assert.ok(good.stability < easy.stability);
  assert.equal(again.lapses, 1);
  assert.equal(easy.lapses, 0);
});

test("successful recall extends a learned card", () => {
  const previous = {
    stability: 3,
    difficulty: 5,
    repetitions: 2,
    lapses: 0,
    lastReviewedAt: 1_700_000_000_000,
  };
  const next = scheduleReview(
    previous,
    3,
    previous.lastReviewedAt + 3 * 86_400_000,
  );
  assert.ok(next.stability > previous.stability);
  assert.ok(next.dueAt > next.lastReviewedAt);
  assert.equal(next.repetitions, 3);
});

test("invalid ratings are rejected", () => {
  assert.throws(() => scheduleReview(null, 0), /rating/);
  assert.throws(() => scheduleReview(null, 5), /rating/);
});
