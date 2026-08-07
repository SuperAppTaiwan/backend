import { VocabularyStatus } from '@prisma/client';
import { nextReviewIntervalDays, nextReviewStatus } from './review-progress.js';

describe('nextReviewIntervalDays', () => {
  it('starts at 1 day after the first review', () => {
    expect(nextReviewIntervalDays(1)).toBe(1);
  });

  it('grows with each subsequent review', () => {
    expect(nextReviewIntervalDays(2)).toBe(2);
    expect(nextReviewIntervalDays(3)).toBe(4);
    expect(nextReviewIntervalDays(4)).toBe(7);
    expect(nextReviewIntervalDays(5)).toBe(14);
  });

  it('caps at the longest interval instead of growing forever', () => {
    expect(nextReviewIntervalDays(6)).toBe(30);
    expect(nextReviewIntervalDays(100)).toBe(30);
  });
});

describe('nextReviewStatus', () => {
  it('stays LEARNING for the first review', () => {
    expect(nextReviewStatus(1)).toBe(VocabularyStatus.LEARNING);
  });

  it('promotes to REVIEW after the second review', () => {
    expect(nextReviewStatus(2)).toBe(VocabularyStatus.REVIEW);
    expect(nextReviewStatus(4)).toBe(VocabularyStatus.REVIEW);
  });

  it('promotes to LEARNED only after a minimum number of reviews, not just one pass', () => {
    expect(nextReviewStatus(5)).toBe(VocabularyStatus.LEARNED);
    expect(nextReviewStatus(1)).not.toBe(VocabularyStatus.LEARNED);
  });
});
