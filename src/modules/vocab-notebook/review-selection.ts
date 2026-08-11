import { VocabularyStatus } from '@prisma/client';

export interface SelectableWord {
  id: string;
  createdAt: Date;
  progress: {
    status: VocabularyStatus;
    nextReviewAt: Date | null;
    lastReviewedAt: Date | null;
    lastReviewSessionId: string | null;
  } | null;
}

/**
 * Fisher-Yates (Durstenfeld) shuffle. Never mutates its input; injectable
 * `randomFn` (defaults to Math.random) is what makes the priority-tier tests
 * below deterministic without weakening real-world randomness.
 */
function shuffle<T>(items: T[], randomFn: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * The session whose words should be treated as "the immediately previous
 * session" for reselection purposes: whichever lastReviewSessionId is
 * attached to the most recently reviewed word in this candidate pool. Pure
 * lookup over already-fetched data — no extra query/table needed.
 */
function findPreviousSessionId(words: SelectableWord[]): string | null {
  let mostRecent: { at: number; sessionId: string } | null = null;
  for (const w of words) {
    const p = w.progress;
    if (!p?.lastReviewedAt || !p.lastReviewSessionId) continue;
    const at = p.lastReviewedAt.getTime();
    if (!mostRecent || at > mostRecent.at) {
      mostRecent = { at, sessionId: p.lastReviewSessionId };
    }
  }
  return mostRecent?.sessionId ?? null;
}

/**
 * Picks up to `count` words for a review session, prioritizing variety over
 * strict spaced-repetition due-dates, while still letting old words return:
 *
 *   Tier 1 — never reviewed (no progress row at all).
 *   Tier 2 — reviewed before but genuinely "not recent": either due
 *            (nextReviewAt <= now) or its interval was never set. Reusing
 *            the SRS due-date here (instead of an arbitrary day threshold)
 *            means "not reviewed recently" tracks the same notion of
 *            staleness the app already computes elsewhere.
 *   Tier 3 — reviewed recently: progress exists and its interval hasn't
 *            elapsed yet (nextReviewAt > now).
 *   Tier 4 — reviewed in the immediately previous session (see
 *            findPreviousSessionId) — lowest priority, but never excluded,
 *            so a small notebook still eventually resurfaces them.
 *
 * Tier 4 classification takes precedence over 2/3: a word from the last
 * session is deprioritized regardless of whether its own interval happens
 * to be due yet. Within each tier, order is Fisher-Yates shuffled so the
 * same eligible set doesn't come back in the same order every time. Pure,
 * deterministic given `now`/`randomFn`, and never throws on a small/empty
 * pool — just returns what's eligible.
 */
export function selectReviewWords(
  words: SelectableWord[],
  count: number,
  now: Date = new Date(),
  randomFn: () => number = Math.random,
): SelectableWord[] {
  const previousSessionId = findPreviousSessionId(words);

  const neverReviewed: SelectableWord[] = [];
  const notRecent: SelectableWord[] = [];
  const recent: SelectableWord[] = [];
  const previousSession: SelectableWord[] = [];

  for (const w of words) {
    const p = w.progress;
    if (!p) {
      neverReviewed.push(w);
      continue;
    }
    if (previousSessionId !== null && p.lastReviewSessionId === previousSessionId) {
      previousSession.push(w);
      continue;
    }
    // A LEARNED word is never treated as "not recent" just because its (capped,
    // 30-day) interval elapsed — it's already mastered, so it shouldn't compete
    // with words still actively being learned for the higher-priority tier.
    const isDue =
      p.status !== VocabularyStatus.LEARNED && (p.nextReviewAt === null || p.nextReviewAt <= now);
    (isDue ? notRecent : recent).push(w);
  }

  return [
    ...shuffle(neverReviewed, randomFn),
    ...shuffle(notRecent, randomFn),
    ...shuffle(recent, randomFn),
    ...shuffle(previousSession, randomFn),
  ].slice(0, count);
}
