import { RecurrenceService } from './recurrence.service.js';

describe('RecurrenceService', () => {
  let service: RecurrenceService;

  beforeEach(() => {
    service = new RecurrenceService();
  });

  describe('buildRRuleString', () => {
    it('builds a weekly single-weekday rule', () => {
      const dtstart = new Date('2026-07-06T09:00:00Z'); // Monday
      const rule = service.buildRRuleString({ frequency: 'WEEKLY', byWeekday: ['MO'] }, dtstart);
      expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO');
    });

    it('builds a weekly multi-weekday rule', () => {
      const dtstart = new Date('2026-07-06T09:00:00Z');
      const rule = service.buildRRuleString(
        { frequency: 'WEEKLY', byWeekday: ['MO', 'WE', 'FR'] },
        dtstart,
      );
      expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    });

    it('builds a weekly rule with interval=2', () => {
      const dtstart = new Date('2026-07-06T09:00:00Z');
      const rule = service.buildRRuleString(
        { frequency: 'WEEKLY', interval: 2, byWeekday: ['TU'] },
        dtstart,
      );
      expect(rule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU');
    });

    it('builds a monthly DAY_OF_MONTH rule', () => {
      const dtstart = new Date('2026-01-31T09:00:00Z');
      const rule = service.buildRRuleString(
        { frequency: 'MONTHLY', monthlyType: 'DAY_OF_MONTH' },
        dtstart,
      );
      expect(rule).toBe('FREQ=MONTHLY;BYMONTHDAY=31');
    });

    it('builds a monthly ORDINAL_WEEKDAY rule', () => {
      // 2026-07-13 is the 2nd Monday of July 2026
      const dtstart = new Date('2026-07-13T09:00:00Z');
      const rule = service.buildRRuleString(
        { frequency: 'MONTHLY', monthlyType: 'ORDINAL_WEEKDAY' },
        dtstart,
      );
      expect(rule).toBe('FREQ=MONTHLY;BYDAY=2MO');
    });

    it('builds a monthly ORDINAL_WEEKDAY "last" rule', () => {
      // 2026-07-27 is the last Monday of July 2026
      const dtstart = new Date('2026-07-27T09:00:00Z');
      const rule = service.buildRRuleString(
        { frequency: 'MONTHLY', monthlyType: 'ORDINAL_WEEKDAY' },
        dtstart,
      );
      expect(rule).toBe('FREQ=MONTHLY;BYDAY=-1MO');
    });

    it('builds a yearly rule', () => {
      const dtstart = new Date('2026-08-20T09:00:00Z');
      const rule = service.buildRRuleString({ frequency: 'YEARLY' }, dtstart);
      expect(rule).toBe('FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=20');
    });

    it('appends UNTIL for endType=UNTIL', () => {
      const dtstart = new Date('2026-07-06T09:00:00Z');
      const rule = service.buildRRuleString(
        { frequency: 'WEEKLY', byWeekday: ['MO'], endType: 'UNTIL', until: '2026-12-31T00:00:00.000Z' },
        dtstart,
      );
      expect(rule).toContain('UNTIL=20261231T000000Z');
    });

    it('appends COUNT for endType=COUNT', () => {
      const dtstart = new Date('2026-07-06T09:00:00Z');
      const rule = service.buildRRuleString(
        { frequency: 'WEEKLY', byWeekday: ['MO'], endType: 'COUNT', count: 5 },
        dtstart,
      );
      expect(rule).toContain('COUNT=5');
    });
  });

  describe('expandOccurrences', () => {
    it('expands weekly single-weekday occurrences', () => {
      const dtstart = new Date('2026-07-06T09:00:00.000Z'); // Monday, treated as Asia/Taipei local (no DST, UTC+8)
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 60 * 60_000),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-07-31T00:00:00Z'),
      );
      expect(occurrences).toHaveLength(4); // Jul 6, 13, 20, 27
      expect(occurrences[0].occurrenceStart.toISOString()).toBe('2026-07-06T09:00:00.000Z');
      expect(occurrences[1].occurrenceStart.toISOString()).toBe('2026-07-13T09:00:00.000Z');
    });

    it('expands weekly multi-weekday occurrences', () => {
      const dtstart = new Date('2026-07-06T09:00:00.000Z'); // Monday
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-07-06T00:00:00Z'),
        new Date('2026-07-13T00:00:00Z'),
      );
      // Mon Jul 6 09:00Z, Wed Jul 8 09:00Z, Fri Jul 10 09:00Z all fall within the range; the next
      // Mon Jul 13 09:00Z occurrence falls after the range's local-equivalent upper bound
      // (2026-07-13T00:00:00Z is 08:00 local in Asia/Taipei, before the 17:00-local event time).
      expect(occurrences.length).toBe(3);
    });

    it('expands weekly with interval=2', () => {
      const dtstart = new Date('2026-07-06T09:00:00.000Z');
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-08-31T00:00:00Z'),
      );
      // Jul 6, Jul 20, Aug 3, Aug 17 fall within range; Aug 31 09:00Z falls just after the
      // range's local-equivalent upper bound (2026-08-31T00:00:00Z is 08:00 local, before 17:00 local).
      expect(occurrences).toHaveLength(4);
      expect(occurrences[1].occurrenceStart.toISOString()).toBe('2026-07-20T09:00:00.000Z');
    });

    it('expands monthly DAY_OF_MONTH occurrences, skipping months without that day (Feb 31 case)', () => {
      const dtstart = new Date('2026-01-31T09:00:00.000Z');
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=31',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-05-01T00:00:00Z'),
      );
      // Jan 31, Mar 31 -- Feb (28 days), Apr (30 days) are deterministically skipped
      const months = occurrences.map((o) => o.occurrenceStart.getUTCMonth() + 1);
      expect(months).toEqual([1, 3]);
    });

    it('expands monthly ORDINAL_WEEKDAY occurrences', () => {
      const dtstart = new Date('2026-07-13T09:00:00.000Z'); // 2nd Monday of July
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=MONTHLY;BYDAY=2MO',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-10-01T00:00:00Z'),
      );
      // 2nd Monday of Jul, Aug, Sep
      expect(occurrences).toHaveLength(3);
      expect(occurrences[1].occurrenceStart.toISOString()).toBe('2026-08-10T09:00:00.000Z');
    });

    it('expands yearly occurrences (ARC-fee-style: same month/day every year)', () => {
      const dtstart = new Date('2026-08-20T09:00:00.000Z');
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: dtstart,
        recurrenceRule: 'FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=20',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-01-01T00:00:00Z'),
        new Date('2029-01-01T00:00:00Z'),
      );
      const dates = occurrences.map((o) => o.occurrenceStart.toISOString().slice(0, 10));
      expect(dates).toEqual(['2026-08-20', '2027-08-20', '2028-08-20']);
    });

    it('skips a Feb 29 yearly anchor entirely in non-leap years but includes leap years', () => {
      const dtstart = new Date('2028-02-29T09:00:00.000Z'); // 2028 is a leap year
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: dtstart,
        recurrenceRule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2028-01-01T00:00:00Z'),
        new Date('2033-01-01T00:00:00Z'),
      );
      const years = occurrences.map((o) => o.occurrenceStart.getUTCFullYear());
      // 2028 and 2032 are leap years; 2029-2031 have no Feb 29 and are skipped.
      expect(years).toEqual([2028, 2032]);
    });

    it('cuts off expansion at UNTIL', () => {
      const dtstart = new Date('2026-07-06T09:00:00.000Z');
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260720T235959Z',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-12-31T00:00:00Z'),
      );
      // Jul 6, 13, 20 only
      expect(occurrences).toHaveLength(3);
    });

    it('limits total occurrences with COUNT', () => {
      const dtstart = new Date('2026-07-06T09:00:00.000Z');
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-12-31T00:00:00Z'),
      );
      expect(occurrences).toHaveLength(3);
    });

    it('cuts off a monthly expansion at UNTIL', () => {
      const dtstart = new Date('2026-01-15T09:00:00.000Z');
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20260315T235959Z',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-12-31T00:00:00Z'),
      );
      // Jan 15, Feb 15, Mar 15 only
      expect(occurrences).toHaveLength(3);
    });

    it('limits a monthly expansion with COUNT', () => {
      const dtstart = new Date('2026-01-15T09:00:00.000Z');
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=4',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-12-31T00:00:00Z'),
      );
      expect(occurrences).toHaveLength(4);
    });

    it('correctly expands when the visible range begins in the middle of an existing series', () => {
      // Series starts Jun 1 (Monday), weekly. Querying a visible range that starts well after
      // the series' own dtstart (e.g. a user paging their calendar to late July) must still
      // return exactly the occurrences that fall inside the requested window — no missing first
      // occurrence, no occurrence bleeding in from before the window.
      const dtstart = new Date('2026-06-01T09:00:00.000Z'); // Monday
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      // Visible range starts mid-series (Jul 20), well after dtstart (Jun 1).
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-07-20T00:00:00Z'),
        new Date('2026-08-10T00:00:00Z'),
      );
      const dates = occurrences.map((o) => o.occurrenceStart.toISOString().slice(0, 10));
      expect(dates).toEqual(['2026-07-20', '2026-07-27', '2026-08-03']);
      // Sanity: none of the pre-window occurrences (Jun 1, Jun 8, ... Jul 13) leaked in.
      expect(dates).not.toContain('2026-07-13');
    });

    it('handles a leap year: monthly BYMONTHDAY=29 includes Feb in a leap year but skips it otherwise', () => {
      const dtstart = new Date('2026-01-29T09:00:00.000Z');
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=29',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      // 2026 is NOT a leap year -> Feb 29 does not exist -> Feb is skipped.
      const occurrences2026 = service.expandOccurrences(
        master,
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z'),
      );
      const months2026 = occurrences2026.map((o) => o.occurrenceStart.getUTCMonth() + 1);
      expect(months2026).toEqual([1, 3]); // Jan, Mar — Feb skipped

      // 2028 IS a leap year -> Feb 29 exists -> Feb is included.
      const dtstart2028 = new Date('2028-01-29T09:00:00.000Z');
      const master2028 = { ...master, startTime: dtstart2028, endTime: new Date(dtstart2028.getTime() + 30 * 60_000) };
      const occurrences2028 = service.expandOccurrences(
        master2028,
        new Date('2028-01-01T00:00:00Z'),
        new Date('2028-04-01T00:00:00Z'),
      );
      const dates2028 = occurrences2028.map((o) => o.occurrenceStart.toISOString().slice(0, 10));
      expect(dates2028).toEqual(['2028-01-29', '2028-02-29', '2028-03-29']);
    });

    it('correctly expands a weekly series across a year boundary (Dec -> Jan)', () => {
      const dtstart = new Date('2026-12-14T09:00:00.000Z'); // Monday
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-12-01T00:00:00Z'),
        new Date('2027-01-31T00:00:00Z'),
      );
      const dates = occurrences.map((o) => o.occurrenceStart.toISOString().slice(0, 10));
      expect(dates).toEqual([
        '2026-12-14', '2026-12-21', '2026-12-28',
        '2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25',
      ]);
    });

    it('is idempotent: expanding the same range twice yields no duplicates and identical results', () => {
      const dtstart = new Date('2026-07-06T09:00:00.000Z');
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 30 * 60_000),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        recurrenceTimezone: 'Asia/Taipei',
        recurrenceEndAt: null,
      };
      const from = new Date('2026-07-01T00:00:00Z');
      const to = new Date('2026-08-01T00:00:00Z');
      const first = service.expandOccurrences(master, from, to);
      const second = service.expandOccurrences(master, from, to);
      expect(first).toEqual(second);
      const starts = first.map((o) => o.occurrenceStart.getTime());
      expect(new Set(starts).size).toBe(starts.length);
    });

    it('preserves local wall-clock time across a DST boundary in a DST-observing timezone', () => {
      // America/New_York DST ends Nov 1, 2026. A 19:00 local weekly event should stay 19:00
      // local both before and after the transition, even though the UTC offset changes.
      const dtstart = new Date('2026-10-19T23:00:00.000Z'); // 19:00 EDT (UTC-4) on Mon Oct 19
      const master = {
        id: 'm1',
        startTime: dtstart,
        endTime: new Date(dtstart.getTime() + 60 * 60_000),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        recurrenceTimezone: 'America/New_York',
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-10-19T00:00:00Z'),
        new Date('2026-11-16T00:00:00Z'),
      );
      // Oct 19 (EDT, UTC-4) -> 23:00Z; Oct 26 (EDT, UTC-4) -> 23:00Z; Nov 2 (EST, UTC-5, after
      // fallback) -> 00:00Z next day; Nov 9 (EST) -> 00:00Z next day. The Nov 16 occurrence falls
      // just after the range's local-equivalent upper bound and is correctly excluded.
      expect(occurrences).toHaveLength(4);
      expect(occurrences[0].occurrenceStart.toISOString()).toBe('2026-10-19T23:00:00.000Z');
      expect(occurrences[1].occurrenceStart.toISOString()).toBe('2026-10-26T23:00:00.000Z');
      // After DST fallback (Nov 1), 19:00 local is UTC-5 -> 00:00Z the next calendar day.
      expect(occurrences[2].occurrenceStart.toISOString()).toBe('2026-11-03T00:00:00.000Z');
      expect(occurrences[3].occurrenceStart.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    });

    it('returns empty array when recurrenceRule is null', () => {
      const master = {
        id: 'm1',
        startTime: new Date('2026-07-06T09:00:00.000Z'),
        endTime: new Date('2026-07-06T10:00:00.000Z'),
        recurrenceRule: null,
        recurrenceTimezone: null,
        recurrenceEndAt: null,
      };
      const occurrences = service.expandOccurrences(
        master,
        new Date('2026-07-01T00:00:00Z'),
        new Date('2026-07-31T00:00:00Z'),
      );
      expect(occurrences).toHaveLength(0);
    });
  });

  describe('applyExceptions', () => {
    it('overrides one occurrence time without affecting siblings', () => {
      const occurrences = [
        { occurrenceStart: new Date('2026-07-06T09:00:00Z'), occurrenceEnd: new Date('2026-07-06T10:00:00Z') },
        { occurrenceStart: new Date('2026-07-13T09:00:00Z'), occurrenceEnd: new Date('2026-07-13T10:00:00Z') },
      ];
      const exceptions = [
        {
          originalOccurrenceStart: new Date('2026-07-06T09:00:00Z'),
          isCancelled: false,
          startTime: new Date('2026-07-06T14:00:00Z'),
          endTime: new Date('2026-07-06T15:00:00Z'),
        },
      ];
      const result = service.applyExceptions(occurrences, exceptions);
      expect(result).toHaveLength(2);
      expect(result[0].occurrenceStart.toISOString()).toBe('2026-07-06T14:00:00.000Z');
      expect(result[1].occurrenceStart.toISOString()).toBe('2026-07-13T09:00:00.000Z');
    });

    it('removes exactly one cancelled occurrence', () => {
      const occurrences = [
        { occurrenceStart: new Date('2026-07-06T09:00:00Z'), occurrenceEnd: new Date('2026-07-06T10:00:00Z') },
        { occurrenceStart: new Date('2026-07-13T09:00:00Z'), occurrenceEnd: new Date('2026-07-13T10:00:00Z') },
        { occurrenceStart: new Date('2026-07-20T09:00:00Z'), occurrenceEnd: new Date('2026-07-20T10:00:00Z') },
      ];
      const exceptions = [
        { originalOccurrenceStart: new Date('2026-07-13T09:00:00Z'), isCancelled: true },
      ];
      const result = service.applyExceptions(occurrences, exceptions);
      expect(result).toHaveLength(2);
      expect(result.map((o) => o.occurrenceStart.toISOString())).toEqual([
        '2026-07-06T09:00:00.000Z',
        '2026-07-20T09:00:00.000Z',
      ]);
    });
  });
});
