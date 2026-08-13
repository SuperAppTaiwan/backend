import { ReviewResult, VocabularyStatus } from '@prisma/client';

// Days-until-next-review, indexed by the review count AFTER this review is
// recorded (1st review -> 1 day, 2nd -> 2 days, ... capped at the last entry).
const REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 14, 30];

export function nextReviewIntervalDays(reviewCountAfter: number): number {
  const idx = Math.min(reviewCountAfter - 1, REVIEW_INTERVAL_DAYS.length - 1);
  return REVIEW_INTERVAL_DAYS[Math.max(0, idx)];
}

// Mirrors the mastery ladder used elsewhere in the project: promotion
// requires a minimum number of completed reviews, not just one pass.
export function nextReviewStatus(reviewCountAfter: number): VocabularyStatus {
  if (reviewCountAfter >= 5) return VocabularyStatus.LEARNED;
  if (reviewCountAfter >= 2) return VocabularyStatus.REVIEW;
  return VocabularyStatus.LEARNING;
}

// Difficulty-rated path (Quick Review's flip-card + AGAIN/HARD/GOOD/EASY flow),
// as opposed to the plain pass-through above (the handwriting-trace flow, which
// has no difficulty rating). Mirrors the legacy learning.service.ts SRS curve so
// both vocabulary systems progress the same way for the same self-rated result.
export function nextFamiliarityFromResult(current: number, result: ReviewResult): number {
  if (result === ReviewResult.AGAIN) return Math.max(0, current - 1);
  if (result === ReviewResult.EASY) return Math.min(10, current + 1);
  return current;
}

export function nextReviewIntervalDaysFromResult(result: ReviewResult): number {
  switch (result) {
    case ReviewResult.AGAIN: return 1;
    case ReviewResult.HARD: return 2;
    case ReviewResult.GOOD: return 4;
    case ReviewResult.EASY: return 7;
  }
}

export function nextReviewStatusFromResult(result: ReviewResult): VocabularyStatus {
  if (result === ReviewResult.EASY) return VocabularyStatus.LEARNED;
  if (result === ReviewResult.AGAIN) return VocabularyStatus.LEARNING;
  return VocabularyStatus.REVIEW;
}
