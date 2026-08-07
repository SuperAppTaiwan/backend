import { VocabularyStatus } from '@prisma/client';

export interface SelectableWord {
  id: string;
  createdAt: Date;
  progress: {
    status: VocabularyStatus;
    nextReviewAt: Date | null;
    lastReviewedAt: Date | null;
  } | null;
}

/**
 * Picks up to `count` words for a review session, prioritizing:
 *   1. Words actively due for review (LEARNING/REVIEW, nextReviewAt <= now) —
 *      the weakest/most overdue first.
 *   2. Words never reviewed at all (NEW), oldest-added first, so nothing in
 *      the notebook sits forever untouched.
 *   3. Everything else, least-recently-reviewed first.
 * Pure and deterministic (no randomness) so it's directly unit-testable.
 * Never throws if fewer than `count` words exist — just returns what's there.
 */
export function selectReviewWords(
  words: SelectableWord[],
  count: number,
  now: Date = new Date(),
): SelectableWord[] {
  const due: SelectableWord[] = [];
  const neverReviewed: SelectableWord[] = [];
  const rest: SelectableWord[] = [];

  for (const w of words) {
    const p = w.progress;
    if (!p) {
      neverReviewed.push(w);
    } else if (
      (p.status === VocabularyStatus.LEARNING || p.status === VocabularyStatus.REVIEW) &&
      p.nextReviewAt !== null &&
      p.nextReviewAt <= now
    ) {
      due.push(w);
    } else {
      rest.push(w);
    }
  }

  due.sort((a, b) => (a.progress!.nextReviewAt!.getTime() - b.progress!.nextReviewAt!.getTime()));
  neverReviewed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  rest.sort((a, b) => {
    const aTime = a.progress?.lastReviewedAt?.getTime() ?? 0;
    const bTime = b.progress?.lastReviewedAt?.getTime() ?? 0;
    return aTime - bTime;
  });

  return [...due, ...neverReviewed, ...rest].slice(0, count);
}
