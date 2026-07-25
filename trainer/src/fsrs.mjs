const WEIGHTS = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
];

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

function initialDifficulty(rating) {
  return clamp(WEIGHTS[4] - Math.exp(WEIGHTS[5] * (rating - 1)) + 1, 1, 10);
}

function nextDifficulty(difficulty, rating) {
  const shifted = difficulty - WEIGHTS[6] * (rating - 3);
  return clamp(
    WEIGHTS[7] * initialDifficulty(3) + (1 - WEIGHTS[7]) * shifted,
    1,
    10,
  );
}

function retrievability(stability, elapsedDays) {
  if (stability <= 0) return 0;
  return (1 + (19 / 81) * (elapsedDays / stability)) ** -0.5;
}

function nextRecallStability(
  stability,
  difficulty,
  retrievabilityValue,
  rating,
) {
  const hardPenalty = rating === 2 ? WEIGHTS[15] : 1;
  const easyBonus = rating === 4 ? WEIGHTS[16] : 1;
  return (
    stability *
    (1 +
      Math.exp(WEIGHTS[8]) *
        (11 - difficulty) *
        stability ** -WEIGHTS[9] *
        (Math.exp((1 - retrievabilityValue) * WEIGHTS[10]) - 1) *
        hardPenalty *
        easyBonus)
  );
}

function nextForgetStability(stability, difficulty, retrievabilityValue) {
  return Math.min(
    Math.exp(WEIGHTS[11]) *
      difficulty ** -WEIGHTS[12] *
      ((stability + 1) ** WEIGHTS[13] - 1) *
      Math.exp((1 - retrievabilityValue) * WEIGHTS[14]),
    stability,
  );
}

/**
 * Advance one card with the FSRS-5 memory-state equations.
 * Ratings are 1=Again, 2=Hard, 3=Good, 4=Easy. Stability is measured in days.
 */
export function scheduleReview(previous, rating, reviewedAt = Date.now()) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 4) {
    throw new RangeError("rating must be an integer from 1 through 4");
  }

  const repetitions = previous?.repetitions ?? 0;
  let stability;
  let difficulty;

  if (repetitions === 0) {
    stability = WEIGHTS[rating - 1];
    difficulty = initialDifficulty(rating);
  } else {
    const oldStability = clamp(Number(previous.stability), 0.01, 36500);
    const oldDifficulty = clamp(Number(previous.difficulty), 1, 10);
    const elapsedDays = Math.max(
      0,
      (reviewedAt - Number(previous.lastReviewedAt)) / 86_400_000,
    );
    const recall = retrievability(oldStability, elapsedDays);
    stability =
      rating === 1
        ? nextForgetStability(oldStability, oldDifficulty, recall)
        : nextRecallStability(oldStability, oldDifficulty, recall, rating);
    difficulty = nextDifficulty(oldDifficulty, rating);
  }

  stability = clamp(stability, 0.01, 36500);
  const intervalDays =
    rating === 1 ? Math.max(0.01, stability) : Math.max(1, stability);

  return {
    difficulty,
    stability,
    repetitions: repetitions + 1,
    lapses: (previous?.lapses ?? 0) + (rating === 1 ? 1 : 0),
    lastReviewedAt: reviewedAt,
    dueAt: reviewedAt + Math.round(intervalDays * 86_400_000),
  };
}
