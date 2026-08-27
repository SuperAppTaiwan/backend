import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RecurringExpense, RecurringExpensePayment } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { RecurrenceService } from '../schedule/recurrence.service.js';
import { FinanceService } from './finance.service.js';
import { CreateRecurringExpenseDto } from './dto/create-recurring-expense.dto.js';
import { UpdateRecurringExpenseDto } from './dto/update-recurring-expense.dto.js';
import { MarkRecurringExpensePaidDto } from './dto/mark-recurring-expense-paid.dto.js';

export type OccurrenceStatus = 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING';

const DEFAULT_TIMEZONE = 'Asia/Taipei';
/** How far past `now` an unpaid backlog is scanned for list/detail status purposes — generous
 * enough that a long-missed weekly bill is still fully visible (see req: "multiple missed
 * periods"), bounded by RecurrenceService's own MAX_OCCURRENCES=500 safety cap either way. */
const STATUS_LOOKAHEAD_DAYS = 400;

interface OccurrenceEntry {
  dueDate: Date;
  status: OccurrenceStatus;
}

@Injectable()
export class RecurringExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly recurrence: RecurrenceService,
    private readonly financeService: FinanceService,
  ) {}

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateRecurringExpenseDto) {
    const firstDueDate = new Date(dto.firstDueDate);
    const recurrenceRule = this.recurrence.buildRRuleString({ frequency: dto.frequency }, firstDueDate);

    if (dto.categoryId) {
      await this.assertCategoryOwned(userId, dto.categoryId);
    }

    const created = await this.prisma.recurringExpense.create({
      data: {
        userId,
        name: dto.name,
        amount: dto.amount,
        currency: dto.currency ?? 'TWD',
        categoryId: dto.categoryId,
        frequency: dto.frequency,
        recurrenceRule,
        recurrenceTimezone: DEFAULT_TIMEZONE,
        firstDueDate,
        reminderOffset: dto.reminderOffset ?? 'NONE',
        note: dto.note,
        isActive: dto.isActive ?? true,
      },
      include: { category: true },
    });

    await this.events.publish({
      userId,
      eventType: EventType.RECURRING_EXPENSE_CREATED,
      sourceModule: 'finance',
      payload: { recurringExpenseId: created.id, frequency: created.frequency },
    });

    return this.toSummaryDto(created, []);
  }

  async findAll(userId: string, includeInactive = false) {
    const items = await this.prisma.recurringExpense.findMany({
      where: { userId, ...(includeInactive ? {} : { isActive: true }) },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
    const payments = await this.loadPayments(items.map((i) => i.id));
    return items.map((item) => this.toSummaryDto(item, payments.get(item.id) ?? []));
  }

  async findOne(userId: string, id: string) {
    const item = await this.prisma.recurringExpense.findFirst({
      where: { id, userId },
      include: { category: true },
    });
    if (!item) throw new NotFoundException('Recurring expense not found');
    const payments = await this.prisma.recurringExpensePayment.findMany({
      where: { recurringExpenseId: id },
      orderBy: { scheduledDueDate: 'desc' },
    });
    return this.toDetailDto(item, payments);
  }

  async update(userId: string, id: string, dto: UpdateRecurringExpenseDto) {
    const existing = await this.findOwned(userId, id);

    if (dto.categoryId) {
      await this.assertCategoryOwned(userId, dto.categoryId);
    }

    // Re-anchoring policy (documented in the DTO too): changing frequency and/or firstDueDate
    // rebuilds the RRULE from this point on. Already-paid occurrences are untouched because
    // RecurringExpensePayment rows are keyed by their own scheduledDueDate, independent of the
    // master's current rule — editing the future due day never rewrites past history.
    const nextFrequency = dto.frequency ?? existing.frequency;
    const nextFirstDueDate = dto.firstDueDate ? new Date(dto.firstDueDate) : existing.firstDueDate;
    const ruleNeedsRebuild = dto.frequency !== undefined || dto.firstDueDate !== undefined;
    const recurrenceRule = ruleNeedsRebuild
      ? this.recurrence.buildRRuleString({ frequency: nextFrequency }, nextFirstDueDate)
      : existing.recurrenceRule;

    const updated = await this.prisma.recurringExpense.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        frequency: nextFrequency,
        recurrenceRule,
        firstDueDate: nextFirstDueDate,
        ...(dto.reminderOffset !== undefined && { reminderOffset: dto.reminderOffset }),
        ...(dto.note !== undefined && { note: dto.note }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { category: true },
    });

    await this.events.publish({
      userId,
      eventType: EventType.RECURRING_EXPENSE_UPDATED,
      sourceModule: 'finance',
      payload: { recurringExpenseId: id },
    });

    const payments = await this.prisma.recurringExpensePayment.findMany({ where: { recurringExpenseId: id } });
    return this.toSummaryDto(updated, payments);
  }

  /** Manual delete (req: confirmation dialog is the mobile client's responsibility). Payment
   * history survives via the schema's SetNull FK — see schema.prisma's RecurringExpensePayment
   * doc comment for the full reasoning. */
  async remove(userId: string, id: string) {
    await this.findOwned(userId, id);
    await this.prisma.recurringExpense.delete({ where: { id } });

    await this.events.publish({
      userId,
      eventType: EventType.RECURRING_EXPENSE_DELETED,
      sourceModule: 'finance',
      payload: { recurringExpenseId: id },
    });

    return { success: true };
  }

  // ─── Payment ─────────────────────────────────────────────────────────────────

  async markPaid(userId: string, id: string, dto: MarkRecurringExpensePaidDto) {
    const master = await this.findOwned(userId, id);
    const scheduledDueDate = new Date(dto.scheduledDueDate);

    if (!this.isRealOccurrence(master, scheduledDueDate)) {
      throw new BadRequestException('scheduledDueDate does not match a real occurrence of this recurring expense');
    }

    let payment: RecurringExpensePayment;
    try {
      payment = await this.prisma.recurringExpensePayment.create({
        data: {
          recurringExpenseId: master.id,
          userId,
          scheduledDueDate,
          amount: master.amount,
          currency: master.currency,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This occurrence has already been marked as paid');
      }
      throw err;
    }

    const createExpenseTransaction = dto.createExpenseTransaction ?? true;
    if (createExpenseTransaction) {
      try {
        const expense = await this.financeService.createExpense(userId, {
          categoryId: master.categoryId ?? undefined,
          amount: master.amount,
          currency: master.currency,
          // The actual money movement happens now (paidAt), not on the (possibly future,
          // for an early payment, or past, for a late one) scheduled due date — this keeps
          // monthly reports/cashflow accurate to when the transaction really occurred.
          expenseDate: payment.paidAt.toISOString(),
          paymentMethod: 'OTHER',
          note: `Thanh toán định kỳ: ${master.name}`,
        });
        payment = await this.prisma.recurringExpensePayment.update({
          where: { id: payment.id },
          data: { expenseId: expense.id },
        });
      } catch {
        // The occurrence is already durably recorded as paid above — a downstream failure to
        // create/link the mirrored Expense transaction must not undo that. Left as expenseId:
        // null; the payment row itself remains the source of truth for "was this period paid".
      }
    }

    await this.events.publish({
      userId,
      eventType: EventType.RECURRING_EXPENSE_PAID,
      sourceModule: 'finance',
      payload: { recurringExpenseId: master.id, paymentId: payment.id, scheduledDueDate: scheduledDueDate.toISOString() },
    });

    let deleted = false;
    if (dto.continueRecurring === false) {
      await this.prisma.recurringExpense.delete({ where: { id: master.id } });
      await this.events.publish({
        userId,
        eventType: EventType.RECURRING_EXPENSE_DELETED,
        sourceModule: 'finance',
        payload: { recurringExpenseId: master.id, reason: 'stopped_after_payment' },
      });
      deleted = true;
    }

    return {
      payment: this.mapPayment(payment),
      recurringExpenseDeleted: deleted,
    };
  }

  async getHistory(userId: string, id: string) {
    await this.findOwned(userId, id);
    const payments = await this.prisma.recurringExpensePayment.findMany({
      where: { recurringExpenseId: id },
      orderBy: { scheduledDueDate: 'desc' },
    });
    return payments.map((p) => this.mapPayment(p));
  }

  // ─── Forecast ────────────────────────────────────────────────────────────────

  /**
   * Single authoritative forecast calculation, shared by both the Home dashboard card and the
   * Finance dashboard's fuller breakdown — neither screen (nor the mobile client at all)
   * duplicates occurrence/recurrence math itself, per the "one shared service layer" requirement.
   * Grouped per-currency rather than summed across currencies, since this app has no exchange-
   * rate conversion system (see finance.service.ts's currency handling elsewhere).
   */
  async getForecast(userId: string, days = 30) {
    const now = new Date();
    const items = await this.prisma.recurringExpense.findMany({
      where: { userId, isActive: true },
      include: { category: true },
    });
    const payments = await this.loadPayments(items.map((i) => i.id));

    const horizonEnd = new Date(now.getTime() + days * 86_400_000);
    const sevenDayEnd = new Date(now.getTime() + 7 * 86_400_000);
    const thirtyDayEnd = new Date(now.getTime() + 30 * 86_400_000);
    // The response always reports both fixed 7/30-day buckets (per the spec's example shape)
    // regardless of the caller's `days` window, which only bounds the `upcoming` list itself.
    const widestEnd = new Date(Math.max(horizonEnd.getTime(), thirtyDayEnd.getTime()));

    const next7: Record<string, number> = {};
    const next30: Record<string, number> = {};
    const overdue: Record<string, number> = {};
    let overdueCount = 0;
    let upcomingCount = 0;
    const upcoming: Array<{
      recurringExpenseId: string;
      name: string;
      amount: number;
      currency: string;
      categoryId: string | null;
      categoryName: string | null;
      dueDate: string;
      status: OccurrenceStatus;
    }> = [];

    for (const item of items) {
      const paidSet = this.paidSetFor(payments.get(item.id) ?? []);
      const occurrences = this.unpaidOccurrences(item, item.firstDueDate, widestEnd, paidSet);

      for (const occ of occurrences) {
        if (occ.status === 'OVERDUE') {
          overdue[item.currency] = (overdue[item.currency] ?? 0) + item.amount;
          overdueCount += 1;
        }
        if (occ.dueDate <= sevenDayEnd) {
          next7[item.currency] = (next7[item.currency] ?? 0) + item.amount;
        }
        if (occ.dueDate <= thirtyDayEnd) {
          next30[item.currency] = (next30[item.currency] ?? 0) + item.amount;
        }

        if (occ.dueDate <= horizonEnd) {
          if (occ.status !== 'OVERDUE') upcomingCount += 1;
          upcoming.push({
            recurringExpenseId: item.id,
            name: item.name,
            amount: item.amount,
            currency: item.currency,
            categoryId: item.categoryId,
            categoryName: item.category?.name ?? null,
            dueDate: occ.dueDate.toISOString(),
            status: occ.status,
          });
        }
      }
    }

    upcoming.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    return {
      next7Days: { amountsByCurrency: next7 },
      next30Days: { amountsByCurrency: next30 },
      overdue: { count: overdueCount, amountsByCurrency: overdue },
      upcomingCount,
      upcoming,
    };
  }

  // ─── Occurrence / status computation ────────────────────────────────────────

  private occurrenceAdapter(re: Pick<RecurringExpense, 'id' | 'recurrenceRule' | 'recurrenceTimezone' | 'firstDueDate'>) {
    return {
      id: re.id,
      startTime: re.firstDueDate,
      endTime: re.firstDueDate,
      recurrenceRule: re.recurrenceRule,
      recurrenceTimezone: re.recurrenceTimezone,
      recurrenceEndAt: null,
    };
  }

  private isRealOccurrence(re: RecurringExpense, candidate: Date): boolean {
    const windowFrom = new Date(candidate.getTime() - 60_000);
    const windowTo = new Date(candidate.getTime() + 60_000);
    const occurrences = this.recurrence.expandOccurrences(this.occurrenceAdapter(re), windowFrom, windowTo);
    return occurrences.some((o) => o.occurrenceStart.getTime() === candidate.getTime());
  }

  private classifyStatus(dueDate: Date, timezone: string): OccurrenceStatus {
    const today = DateTime.now().setZone(timezone).startOf('day');
    const due = DateTime.fromJSDate(dueDate, { zone: timezone }).startOf('day');
    if (due < today) return 'OVERDUE';
    if (due.equals(today)) return 'DUE_TODAY';
    return 'UPCOMING';
  }

  private paidSetFor(payments: RecurringExpensePayment[]): Set<number> {
    return new Set(payments.map((p) => p.scheduledDueDate.getTime()));
  }

  /** All unpaid occurrences of `re` between `from` and `to`, each tagged with its status. */
  private unpaidOccurrences(
    re: RecurringExpense,
    from: Date,
    to: Date,
    paidSet: Set<number>,
  ): OccurrenceEntry[] {
    const occurrences = this.recurrence.expandOccurrences(this.occurrenceAdapter(re), from, to);
    return occurrences
      .filter((o) => !paidSet.has(o.occurrenceStart.getTime()))
      .map((o) => ({ dueDate: o.occurrenceStart, status: this.classifyStatus(o.occurrenceStart, re.recurrenceTimezone) }));
  }

  private async loadPayments(recurringExpenseIds: string[]): Promise<Map<string, RecurringExpensePayment[]>> {
    if (recurringExpenseIds.length === 0) return new Map();
    const rows = await this.prisma.recurringExpensePayment.findMany({
      where: { recurringExpenseId: { in: recurringExpenseIds } },
    });
    const map = new Map<string, RecurringExpensePayment[]>();
    for (const row of rows) {
      if (!row.recurringExpenseId) continue;
      const arr = map.get(row.recurringExpenseId) ?? [];
      arr.push(row);
      map.set(row.recurringExpenseId, arr);
    }
    return map;
  }

  private async findOwned(userId: string, id: string): Promise<RecurringExpense> {
    const item = await this.prisma.recurringExpense.findFirst({ where: { id, userId } });
    if (!item) throw new NotFoundException('Recurring expense not found');
    return item;
  }

  private async assertCategoryOwned(userId: string, categoryId: string) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, OR: [{ userId }, { isDefault: true }] },
    });
    if (!category) throw new NotFoundException('Expense category not found');
  }

  // ─── Mappers ─────────────────────────────────────────────────────────────────

  private toSummaryDto(
    re: RecurringExpense & { category?: { id: string; name: string } | null },
    payments: RecurringExpensePayment[],
  ) {
    const paidSet = this.paidSetFor(payments);
    const now = new Date();
    const horizon = new Date(now.getTime() + STATUS_LOOKAHEAD_DAYS * 86_400_000);
    const unpaid = this.unpaidOccurrences(re, re.firstDueDate, horizon, paidSet);

    const overdueOccurrences = unpaid.filter((o) => o.status === 'OVERDUE');
    const primary = overdueOccurrences[0] ?? unpaid.find((o) => o.status === 'DUE_TODAY') ?? unpaid[0] ?? null;

    const lastPaid = payments.length
      ? payments.reduce((latest, p) => (p.scheduledDueDate > latest.scheduledDueDate ? p : latest))
      : null;

    return {
      id: re.id,
      userId: re.userId,
      name: re.name,
      amount: re.amount,
      currency: re.currency,
      categoryId: re.categoryId,
      categoryName: re.category?.name ?? null,
      frequency: re.frequency,
      firstDueDate: re.firstDueDate.toISOString(),
      reminderOffset: re.reminderOffset,
      note: re.note,
      isActive: re.isActive,
      nextDueDate: primary ? primary.dueDate.toISOString() : null,
      status: primary ? primary.status : 'PAID_AHEAD',
      overdueCount: overdueOccurrences.length,
      lastPaidDueDate: lastPaid ? lastPaid.scheduledDueDate.toISOString() : null,
      createdAt: re.createdAt.toISOString(),
      updatedAt: re.updatedAt.toISOString(),
    };
  }

  private toDetailDto(
    re: RecurringExpense & { category?: { id: string; name: string } | null },
    payments: RecurringExpensePayment[],
  ) {
    return {
      ...this.toSummaryDto(re, payments),
      recurrenceRule: re.recurrenceRule,
      recurrenceTimezone: re.recurrenceTimezone,
      paymentHistory: payments.map((p) => this.mapPayment(p)),
    };
  }

  private mapPayment(p: RecurringExpensePayment) {
    return {
      id: p.id,
      recurringExpenseId: p.recurringExpenseId,
      scheduledDueDate: p.scheduledDueDate.toISOString(),
      paidAt: p.paidAt.toISOString(),
      amount: p.amount,
      currency: p.currency,
      expenseId: p.expenseId,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
