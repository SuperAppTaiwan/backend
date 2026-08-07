import { VocabularyStatus } from '@prisma/client';

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
