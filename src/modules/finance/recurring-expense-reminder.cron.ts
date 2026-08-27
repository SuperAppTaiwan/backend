import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationType, RecurringExpense } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RecurrenceService } from '../schedule/recurrence.service.js';

const REMINDER_OFFSET_DAYS: Record<string, number | null> = {
  NONE: null,
  ON_DUE_DATE: 0,
  DAYS_1: 1,
  DAYS_3: 3,
  DAYS_7: 7,
};

/**
 * Daily reminder trigger for recurring expenses, reusing the existing Notification/push
 * pipeline end-to-end (NotificationsService.createNotification already handles storage, the
 * in-app notification center, quiet hours, and Expo push delivery) — this class is the only
 * new piece: a periodic trigger, not a second notification architecture.
 *
 * No stale-reminder bookkeeping is needed: every run re-derives the current nearest unpaid
 * occurrence fresh from live data, so a paid/deleted/edited/paused obligation simply stops
 * matching the threshold check on its own — there is no scheduled job object to cancel.
 *
 * Known limitation: this only fires while the Nest process is running. On a host that sleeps
 * when idle (e.g. Render's free tier, referenced elsewhere in this project's notes), a
 * reminder due during a sleep window is skipped for that day rather than queued/delayed.
 */
@Injectable()
export class RecurringExpenseReminderCron {
  private readonly logger = new Logger(RecurringExpenseReminderCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly recurrence: RecurrenceService,
  ) {}

  @Cron('0 8 * * *', { timeZone: 'Asia/Taipei' })
  async sendDueReminders() {
    const candidates = await this.prisma.recurringExpense.findMany({
      where: { isActive: true, reminderOffset: { not: 'NONE' } },
    });

    for (const re of candidates) {
      try {
        await this.maybeRemindOne(re);
      } catch (err) {
        this.logger.error(`Failed to evaluate reminder for recurring expense ${re.id}`, err);
      }
    }
  }

  private async maybeRemindOne(re: RecurringExpense) {
    const offsetDays = REMINDER_OFFSET_DAYS[re.reminderOffset];
    if (offsetDays === null || offsetDays === undefined) return;

    const prefs = await this.prisma.notificationPreference.findUnique({ where: { userId: re.userId } });
    if (prefs && !prefs.recurringExpenseReminder) return;

    const todayLocal = DateTime.now().setZone(re.recurrenceTimezone).startOf('day');
    if (re.lastReminderSentAt) {
      const lastSentLocal = DateTime.fromJSDate(re.lastReminderSentAt, { zone: re.recurrenceTimezone }).startOf('day');
      if (lastSentLocal.equals(todayLocal)) return; // already reminded today
    }

    const now = todayLocal.toJSDate();
    const horizon = new Date(now.getTime() + 60 * 86_400_000);
    const occurrences = this.recurrence.expandOccurrences(
      { id: re.id, startTime: re.firstDueDate, endTime: re.firstDueDate, recurrenceRule: re.recurrenceRule, recurrenceTimezone: re.recurrenceTimezone, recurrenceEndAt: null },
      re.firstDueDate,
      horizon,
    );
    if (occurrences.length === 0) return;

    const payments = await this.prisma.recurringExpensePayment.findMany({ where: { recurringExpenseId: re.id } });
    const paidSet = new Set(payments.map((p) => p.scheduledDueDate.getTime()));
    const nextUnpaid = occurrences.find((o) => !paidSet.has(o.occurrenceStart.getTime()));
    if (!nextUnpaid) return;

    const dueLocal = DateTime.fromJSDate(nextUnpaid.occurrenceStart, { zone: re.recurrenceTimezone }).startOf('day');
    const daysUntilDue = Math.ceil(dueLocal.diff(todayLocal, 'days').days);
    // An already-overdue occurrence (daysUntilDue < 0) is still reminded once per day at the
    // ON_DUE_DATE/offset threshold or later — the user should keep being nudged, not go silent
    // just because the offset window has technically passed.
    if (daysUntilDue > offsetDays) return;

    await this.notifications.createNotification(
      re.userId,
      NotificationType.RECURRING_EXPENSE_DUE,
      'Sắp đến hạn thanh toán định kỳ',
      `${re.name} — ${re.amount.toLocaleString('vi-VN')} ${re.currency}, hạn ${dueLocal.toFormat('dd/MM/yyyy')}`,
    );

    await this.prisma.recurringExpense.update({
      where: { id: re.id },
      data: { lastReminderSentAt: now },
    });
  }
}
