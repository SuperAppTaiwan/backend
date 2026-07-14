import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { RRule } from 'rrule';

export type RecurrenceFrequency = 'WEEKLY' | 'MONTHLY';
export type RecurrenceMonthlyType = 'DAY_OF_MONTH' | 'ORDINAL_WEEKDAY';
export type RecurrenceEndType = 'NEVER' | 'UNTIL' | 'COUNT';
export type WeekdayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export interface RecurrenceInput {
  frequency: RecurrenceFrequency;
  interval?: number;
  byWeekday?: WeekdayCode[];
  monthlyType?: RecurrenceMonthlyType;
  endType?: RecurrenceEndType;
  until?: string;
  count?: number;
}

export interface OccurrenceMasterLike {
  id: string;
  seriesId?: string | null;
  startTime?: Date | null;
  endTime?: Date | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  recurrenceRule?: string | null;
  recurrenceTimezone?: string | null;
  recurrenceEndAt?: Date | null;
}

export interface Occurrence {
  occurrenceStart: Date;
  occurrenceEnd: Date;
}

export interface ExceptionRowLike {
  originalOccurrenceStart: Date | null;
  isCancelled: boolean;
  [key: string]: unknown;
}

/** Hard cap on the number of occurrences a single expansion call may generate, to prevent abuse via huge ranges. */
const MAX_OCCURRENCES = 500;

const DEFAULT_TIMEZONE = 'Asia/Taipei';

function ordinalForDayOfMonth(day: number): number {
  return Math.ceil(day / 7);
}

/**
 * Builds an RFC5545 RRULE string from a structured recurrence input.
 *
 * Known, deterministic policy: for MONTHLY/DAY_OF_MONTH rules, months that don't contain
 * that day-of-month (e.g. BYMONTHDAY=31 in February, or in any 30-day month) are skipped
 * entirely for that month. This is rrule's/RFC5545's native standard behavior and is the
 * chosen policy here, not a bug — we do not "roll over" to the nearest valid day.
 */
@Injectable()
export class RecurrenceService {
  buildRRuleString(input: RecurrenceInput, dtstart: Date): string {
    const parts: string[] = [];
    parts.push(`FREQ=${input.frequency}`);

    const interval = input.interval ?? 1;
    if (interval && interval > 1) {
      parts.push(`INTERVAL=${interval}`);
    }

    if (input.frequency === 'WEEKLY') {
      if (input.byWeekday && input.byWeekday.length > 0) {
        parts.push(`BYDAY=${input.byWeekday.join(',')}`);
      }
    } else if (input.frequency === 'MONTHLY') {
      const monthlyType = input.monthlyType ?? 'DAY_OF_MONTH';
      if (monthlyType === 'DAY_OF_MONTH') {
        const dayOfMonth = dtstart.getUTCDate();
        parts.push(`BYMONTHDAY=${dayOfMonth}`);
      } else {
        // ORDINAL_WEEKDAY: derive ordinal (1-5, or -1 for "last") + weekday code from dtstart's
        // position in its month.
        const day = dtstart.getUTCDate();
        const jsWeekday = dtstart.getUTCDay(); // 0=Sun..6=Sat
        const weekdayCodes: WeekdayCode[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        const weekdayCode = weekdayCodes[jsWeekday];

        const daysInMonth = new Date(
          Date.UTC(dtstart.getUTCFullYear(), dtstart.getUTCMonth() + 1, 0),
        ).getUTCDate();
        const isLastOccurrence = day + 7 > daysInMonth;
        const ordinal = isLastOccurrence ? -1 : ordinalForDayOfMonth(day);
        parts.push(`BYDAY=${ordinal}${weekdayCode}`);
      }
    }

    const endType = input.endType ?? 'NEVER';
    if (endType === 'UNTIL' && input.until) {
      const untilUtc = DateTime.fromISO(input.until, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
      parts.push(`UNTIL=${untilUtc}`);
    } else if (endType === 'COUNT' && input.count) {
      parts.push(`COUNT=${input.count}`);
    }

    return parts.join(';');
  }

  /**
   * Expands a recurring master record's RRULE into concrete occurrences within [rangeFrom, rangeTo],
   * timezone-aware: dtstart is interpreted in the record's timezone (falling back to Asia/Taipei),
   * and each generated occurrence's wall-clock local time is preserved across DST transitions by
   * recomputing local time -> UTC per-occurrence via luxon, rather than naively adding milliseconds.
   */
  expandOccurrences(
    master: OccurrenceMasterLike,
    rangeFrom: Date,
    rangeTo: Date,
  ): Occurrence[] {
    if (!master.recurrenceRule) return [];

    const masterStart = master.startTime ?? master.scheduledStart;
    const masterEnd = master.endTime ?? master.scheduledEnd;
    if (!masterStart || !masterEnd) return [];

    const timezone = master.recurrenceTimezone || DEFAULT_TIMEZONE;
    const durationMs = masterEnd.getTime() - masterStart.getTime();

    // Convert master start (a UTC-instant JS Date) into the local wall-clock time in `timezone`,
    // then build a "floating" local dtstart for rrule to walk. rrule operates on plain
    // date/time components (no tz math), so we let luxon own all tz/DST conversion and only use
    // rrule to generate the calendar-recurrence pattern in local wall-clock space.
    const localStart = DateTime.fromJSDate(masterStart, { zone: timezone });
    const floatingDtstart = new Date(
      Date.UTC(
        localStart.year,
        localStart.month - 1,
        localStart.day,
        localStart.hour,
        localStart.minute,
        localStart.second,
      ),
    );

    const ruleOptions = RRule.parseString(master.recurrenceRule);
    ruleOptions.dtstart = floatingDtstart;

    // Effective end: min(recurrenceEndAt, rangeTo), still bounded by the rule's own UNTIL/COUNT.
    let effectiveRangeTo = rangeTo;
    if (master.recurrenceEndAt && master.recurrenceEndAt < effectiveRangeTo) {
      effectiveRangeTo = master.recurrenceEndAt;
    }
    if (effectiveRangeTo < rangeFrom) return [];

    // Convert range bounds into the same "floating local as UTC" space for rrule's `between`.
    const localFrom = DateTime.fromJSDate(rangeFrom, { zone: timezone });
    const floatingFrom = new Date(
      Date.UTC(localFrom.year, localFrom.month - 1, localFrom.day, localFrom.hour, localFrom.minute, localFrom.second),
    );
    const localTo = DateTime.fromJSDate(effectiveRangeTo, { zone: timezone });
    const floatingTo = new Date(
      Date.UTC(localTo.year, localTo.month - 1, localTo.day, localTo.hour, localTo.minute, localTo.second),
    );

    const rule = new RRule(ruleOptions);
    const floatingOccurrences = rule.between(floatingFrom, floatingTo, true, (_date, i) => i < MAX_OCCURRENCES);

    const capped = floatingOccurrences.slice(0, MAX_OCCURRENCES);

    return capped.map((floatingDate) => {
      // floatingDate carries the correct local wall-clock components (in UTC-labelled fields);
      // reinterpret those components in the target timezone to get the correct real UTC instant,
      // preserving wall-clock time across any DST transition.
      const occurrenceLocal = DateTime.fromObject(
        {
          year: floatingDate.getUTCFullYear(),
          month: floatingDate.getUTCMonth() + 1,
          day: floatingDate.getUTCDate(),
          hour: floatingDate.getUTCHours(),
          minute: floatingDate.getUTCMinutes(),
          second: floatingDate.getUTCSeconds(),
        },
        { zone: timezone },
      );
      const occurrenceStart = occurrenceLocal.toJSDate();
      const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
      return { occurrenceStart, occurrenceEnd };
    });
  }

  /**
   * Applies exception rows (same seriesId, isRecurrenceException=true) to a list of virtual
   * occurrences: matching exceptions (keyed by originalOccurrenceStart) override the occurrence's
   * start/end (and any other exception-provided fields), and cancelled exceptions drop the
   * occurrence entirely.
   */
  applyExceptions<T extends ExceptionRowLike>(
    occurrences: Occurrence[],
    exceptions: T[],
  ): Array<Occurrence & { exception?: T }> {
    const exceptionsByTime = new Map<number, T>();
    for (const exception of exceptions) {
      if (!exception.originalOccurrenceStart) continue;
      exceptionsByTime.set(exception.originalOccurrenceStart.getTime(), exception);
    }

    const result: Array<Occurrence & { exception?: T }> = [];
    for (const occurrence of occurrences) {
      const exception = exceptionsByTime.get(occurrence.occurrenceStart.getTime());
      if (exception) {
        if (exception.isCancelled) continue;
        const exStart = (exception['startTime'] ?? exception['scheduledStart']) as Date | undefined;
        const exEnd = (exception['endTime'] ?? exception['scheduledEnd']) as Date | undefined;
        result.push({
          occurrenceStart: exStart ?? occurrence.occurrenceStart,
          occurrenceEnd: exEnd ?? occurrence.occurrenceEnd,
          exception,
        });
      } else {
        result.push(occurrence);
      }
    }
    return result;
  }
}
