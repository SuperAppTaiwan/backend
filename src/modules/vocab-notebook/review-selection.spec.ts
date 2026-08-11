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

function reviewedWord(
  id: string,
  opts: {
    status?: VocabularyStatus;
    nextReviewAt: Date | null;
    lastReviewedAt: Date;
    lastReviewSessionId?: string | null;
  },
): SelectableWord {
  return word(id, {
    progress: {
      status: opts.status ?? VocabularyStatus.LEARNING,
      nextReviewAt: opts.nextReviewAt,
      lastReviewedAt: opts.lastReviewedAt,
      lastReviewSessionId: opts.lastReviewSessionId ?? null,
    },
  });
}

// A fixed, seeded sequence lets tests assert on shuffle output deterministically
// instead of asserting "not equal to input order" (which is flaky ~1/n! of the
// time for tiny n) or mocking Math.random with brittle call-count assumptions.
function seededRandom(seed: number[]): () => number {
  let i = 0;
  return () => seed[i++ % seed.length];
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

  it('never duplicates a word within one selection', () => {
    const words = Array.from({ length: 15 }, (_, i) => word(`w${i}`));
    const result = selectReviewWords(words, 10, now);
    expect(new Set(result.map((w) => w.id)).size).toBe(result.length);
  });

  // ─── Priority 1: never reviewed ────────────────────────────────────────

  it('prefers never-reviewed words over any previously-reviewed word', () => {
    const neverReviewed = word('new');
    const due = reviewedWord('due', {
      nextReviewAt: new Date('2026-08-01T00:00:00Z'),
      lastReviewedAt: new Date('2026-07-31T00:00:00Z'),
    });
    const notDue = reviewedWord('not-due', {
      status: VocabularyStatus.REVIEW,
      nextReviewAt: new Date('2026-12-01T00:00:00Z'),
      lastReviewedAt: new Date('2026-08-06T00:00:00Z'),
    });

    const result = selectReviewWords([due, notDue, neverReviewed], 1, now);
    expect(result).toEqual([neverReviewed]);
  });

  // ─── Priority 2 vs 3: not-recent (due) outranks recently-reviewed (not due) ──

  it('prefers a word that is due (not reviewed recently) over one reviewed recently and not yet due', () => {
    const due = reviewedWord('due', {
      nextReviewAt: new Date('2026-08-01T00:00:00Z'), // in the past relative to `now`
      lastReviewedAt: new Date('2026-07-31T00:00:00Z'),
    });
    const notDueYet = reviewedWord('not-due', {
      status: VocabularyStatus.REVIEW,
      nextReviewAt: new Date('2026-12-01T00:00:00Z'), // in the future
      lastReviewedAt: new Date('2026-08-06T00:00:00Z'),
    });

    const result = selectReviewWords([notDueYet, due], 1, now);
    expect(result).toEqual([due]);
  });

  it('does not treat a LEARNED word as due even if its interval elapsed', () => {
    const learned = reviewedWord('learned', {
      status: VocabularyStatus.LEARNED,
      nextReviewAt: new Date('2026-01-01T00:00:00Z'),
      lastReviewedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const due = reviewedWord('due', {
      nextReviewAt: new Date('2026-08-01T00:00:00Z'),
      lastReviewedAt: new Date('2026-07-31T00:00:00Z'),
    });

    const result = selectReviewWords([learned, due], 1, now);
    expect(result).toEqual([due]);
  });

  // ─── Priority 4: immediately-previous-session words are deprioritized ────

  it('deprioritizes words from the immediately previous session below never-reviewed and due words', () => {
    const prevSessionWord = reviewedWord('prev', {
      nextReviewAt: new Date('2026-12-01T00:00:00Z'), // not due — would otherwise look "recent"
      lastReviewedAt: new Date('2026-08-07T11:00:00Z'), // most recent review -> defines "previous session"
      lastReviewSessionId: 'session-2',
    });
    const olderSessionWord = reviewedWord('older-session', {
      nextReviewAt: new Date('2026-12-01T00:00:00Z'),
      lastReviewedAt: new Date('2026-08-05T00:00:00Z'),
      lastReviewSessionId: 'session-1',
    });
    const neverReviewed = word('new');

    const result = selectReviewWords([prevSessionWord, olderSessionWord, neverReviewed], 3, now);
    // never-reviewed first, then the older (non-previous-session) reviewed word,
    // then the most-recent-session word last.
    expect(result.map((w) => w.id)).toEqual(['new', 'older-session', 'prev']);
  });

  it('does not immediately repeat the previous session\'s exact word set when enough alternatives exist', () => {
    // Day 1: pool of 20, review A-J (session-1).
    const reviewedYesterday = 'ABCDEFGHIJ'.split('').map((id) =>
      reviewedWord(id, {
        nextReviewAt: new Date('2026-08-08T12:00:00Z'), // 1-day interval, not due "today" at noon
        lastReviewedAt: new Date('2026-08-07T09:00:00Z'),
        lastReviewSessionId: 'session-1',
      }),
    );
    const untouched = 'KLMNOPQRST'.split('').map((id) => word(id));

    // Day 2, same time next day.
    const day2 = new Date('2026-08-08T12:00:00Z');
    const result = selectReviewWords([...reviewedYesterday, ...untouched], 10, day2);

    expect(result.map((w) => w.id).sort()).toEqual('KLMNOPQRST'.split('').sort());
  });

  it('eventually returns previously-reviewed words once every alternative is exhausted (small notebook)', () => {
    // 12 words, 10 reviewed yesterday in one session, 2 never touched.
    const reviewedYesterday = Array.from({ length: 10 }, (_, i) =>
      reviewedWord(`r${i}`, {
        nextReviewAt: new Date('2026-08-08T12:00:00Z'),
        lastReviewedAt: new Date('2026-08-07T09:00:00Z'),
        lastReviewSessionId: 'session-1',
      }),
    );
    const untouched = [word('u0'), word('u1')];

    const result = selectReviewWords([...reviewedYesterday, ...untouched], 10, new Date('2026-08-08T12:00:00Z'));

    expect(result).toHaveLength(10);
    // The 2 never-reviewed words are included...
    expect(result.map((w) => w.id)).toEqual(expect.arrayContaining(['u0', 'u1']));
    // ...and the remaining 8 slots are filled from yesterday's previous-session words
    // (there's nothing else left), proving old words are never permanently excluded.
    const filledFromPrevSession = result.filter((w) => w.id.startsWith('r'));
    expect(filledFromPrevSession).toHaveLength(8);
  });

  it('returns only the available words for a small notebook without erroring (5 words, 10 requested)', () => {
    const words = Array.from({ length: 5 }, (_, i) => word(`w${i}`));
    const result = selectReviewWords(words, 10, now);
    expect(result).toHaveLength(5);
    expect(new Set(result.map((w) => w.id)).size).toBe(5);
  });

  // ─── Randomization ──────────────────────────────────────────────────────

  it('shuffles equally-eligible words instead of returning them in input order', () => {
    const words = Array.from({ length: 8 }, (_, i) => word(`w${i}`));
    // A fixed, non-trivial seed sequence produces a concrete, reproducible permutation.
    const randomFn = seededRandom([0.9, 0.1, 0.7, 0.3, 0.5, 0.2, 0.8]);

    const result = selectReviewWords(words, 8, now, randomFn);

    expect(result.map((w) => w.id)).not.toEqual(words.map((w) => w.id));
    expect(new Set(result.map((w) => w.id))).toEqual(new Set(words.map((w) => w.id)));
  });

  it('produces a different order across two different random sequences (no fixed bias)', () => {
    const words = Array.from({ length: 8 }, (_, i) => word(`w${i}`));
    const resultA = selectReviewWords(words, 8, now, seededRandom([0.9, 0.1, 0.7, 0.3, 0.5, 0.2, 0.8]));
    const resultB = selectReviewWords(words, 8, now, seededRandom([0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.05]));

    expect(resultA.map((w) => w.id)).not.toEqual(resultB.map((w) => w.id));
  });

  // ─── Category filtering (caller responsibility, verified end-to-end here) ─

  it('only ever selects from the words it is given — category filtering happens by the caller before this runs', () => {
    const hsk1 = [word('h1'), word('h2')];
    const result = selectReviewWords(hsk1, 10, now);
    expect(result.map((w) => w.id).sort()).toEqual(['h1', 'h2']);
  });
});
