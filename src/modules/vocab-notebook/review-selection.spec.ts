import { VocabularyStatus } from '@prisma/client';
import { selectReviewWords, SelectableWord } from './review-selection.js';

const now = new Date('2026-08-07T12:00:00Z');

function word(id: string, overrides: Partial<SelectableWord> = {}): SelectableWord {
  return {
    id,
    createdAt: now,
    progress: null,
    ...overrides,
  };
}

describe('selectReviewWords', () => {
  it('returns all words without erroring when fewer exist than requested', () => {
    const words = [word('a'), word('b')];
    const result = selectReviewWords(words, 10, now);
    expect(result).toHaveLength(2);
  });

  it('returns an empty array for an empty notebook', () => {
    expect(selectReviewWords([], 10, now)).toEqual([]);
  });

  it('prioritizes words overdue for review over never-reviewed words', () => {
    const overdue = word('overdue', {
      progress: {
        status: VocabularyStatus.LEARNING,
        nextReviewAt: new Date('2026-08-01T00:00:00Z'),
        lastReviewedAt: new Date('2026-07-31T00:00:00Z'),
      },
    });
    const neverReviewed = word('new', { createdAt: new Date('2026-01-01T00:00:00Z') });

    const result = selectReviewWords([neverReviewed, overdue], 1, now);
    expect(result).toEqual([overdue]);
  });

  it('prioritizes never-reviewed words over words not yet due', () => {
    const notDueYet = word('not-due', {
      progress: {
        status: VocabularyStatus.REVIEW,
        nextReviewAt: new Date('2026-12-01T00:00:00Z'),
        lastReviewedAt: new Date('2026-08-01T00:00:00Z'),
      },
    });
    const neverReviewed = word('new');

    const result = selectReviewWords([notDueYet, neverReviewed], 1, now);
    expect(result).toEqual([neverReviewed]);
  });

  it('orders overdue words by soonest-overdue first', () => {
    const moreOverdue = word('more-overdue', {
      progress: {
        status: VocabularyStatus.LEARNING,
        nextReviewAt: new Date('2026-07-01T00:00:00Z'),
        lastReviewedAt: new Date('2026-06-30T00:00:00Z'),
      },
    });
    const lessOverdue = word('less-overdue', {
      progress: {
        status: VocabularyStatus.LEARNING,
        nextReviewAt: new Date('2026-08-05T00:00:00Z'),
        lastReviewedAt: new Date('2026-08-01T00:00:00Z'),
      },
    });

    const result = selectReviewWords([lessOverdue, moreOverdue], 2, now);
    expect(result.map((w) => w.id)).toEqual(['more-overdue', 'less-overdue']);
  });

  it('orders never-reviewed words oldest-added first', () => {
    const older = word('older', { createdAt: new Date('2026-01-01T00:00:00Z') });
    const newer = word('newer', { createdAt: new Date('2026-06-01T00:00:00Z') });

    const result = selectReviewWords([newer, older], 2, now);
    expect(result.map((w) => w.id)).toEqual(['older', 'newer']);
  });

  it('treats a word not yet due as lowest priority, least-recently-reviewed first', () => {
    const lessRecent = word('less-recent', {
      progress: {
        status: VocabularyStatus.REVIEW,
        nextReviewAt: new Date('2026-12-01T00:00:00Z'),
        lastReviewedAt: new Date('2026-06-01T00:00:00Z'),
      },
    });
    const moreRecent = word('more-recent', {
      progress: {
        status: VocabularyStatus.REVIEW,
        nextReviewAt: new Date('2026-12-01T00:00:00Z'),
        lastReviewedAt: new Date('2026-08-01T00:00:00Z'),
      },
    });

    const result = selectReviewWords([moreRecent, lessRecent], 2, now);
    expect(result.map((w) => w.id)).toEqual(['less-recent', 'more-recent']);
  });

  it('does not treat LEARNED words as due even if nextReviewAt has passed', () => {
    const learned = word('learned', {
      progress: {
        status: VocabularyStatus.LEARNED,
        nextReviewAt: new Date('2026-01-01T00:00:00Z'),
        lastReviewedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const overdue = word('overdue', {
      progress: {
        status: VocabularyStatus.LEARNING,
        nextReviewAt: new Date('2026-08-01T00:00:00Z'),
        lastReviewedAt: new Date('2026-07-31T00:00:00Z'),
      },
    });

    const result = selectReviewWords([learned, overdue], 1, now);
    expect(result).toEqual([overdue]);
  });
});
