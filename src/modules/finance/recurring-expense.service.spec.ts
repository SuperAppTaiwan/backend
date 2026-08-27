import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { RecurringExpenseService } from './recurring-expense.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { RecurrenceService } from '../schedule/recurrence.service.js';
import { FinanceService } from './finance.service.js';

const mockPrisma = {
  recurringExpense: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  recurringExpensePayment: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  expenseCategory: { findFirst: jest.fn() },
};

const mockEvents = { publish: jest.fn().mockResolvedValue(undefined) };
const mockFinanceService = { createExpense: jest.fn() };

function makeRe(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 're-1',
    userId: 'u-1',
    name: 'Tiền nhà',
    amount: 10000,
    currency: 'TWD',
    categoryId: null,
    frequency: 'MONTHLY',
    recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=5',
    recurrenceTimezone: 'Asia/Taipei',
    firstDueDate: new Date('2026-01-05T00:00:00.000Z'),
    reminderOffset: 'NONE',
    note: null,
    isActive: true,
    lastReminderSentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: null,
    ...overrides,
  };
}

describe('RecurringExpenseService', () => {
  let service: RecurringExpenseService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringExpenseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        RecurrenceService,
        { provide: FinanceService, useValue: mockFinanceService },
      ],
    }).compile();

    service = module.get<RecurringExpenseService>(RecurringExpenseService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // `Date.now = () => fixed` alone does NOT affect `new Date()` (V8's zero-arg constructor
  // reads its own internal clock, not the JS-visible Date.now function) — real fake timers
  // are required to freeze both consistently.
  function freezeNow(iso: string) {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date(iso));
  }

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('builds a MONTHLY RRULE from firstDueDate and publishes an event', async () => {
      const created = makeRe();
      mockPrisma.recurringExpense.create.mockResolvedValue(created);

      const result = await service.create('u-1', {
        name: 'Tiền nhà',
        amount: 10000,
        frequency: 'MONTHLY' as never,
        firstDueDate: '2026-01-05',
      });

      expect(mockPrisma.recurringExpense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=5' }),
        }),
      );
      expect(result.name).toBe('Tiền nhà');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'RECURRING_EXPENSE_CREATED' }),
      );
    });

    it('builds a YEARLY RRULE (ARC-fee style)', async () => {
      mockPrisma.recurringExpense.create.mockResolvedValue(
        makeRe({ frequency: 'YEARLY', recurrenceRule: 'FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=20', firstDueDate: new Date('2027-08-20T00:00:00.000Z') }),
      );

      await service.create('u-1', {
        name: 'ARC fee',
        amount: 1000,
        frequency: 'YEARLY' as never,
        firstDueDate: '2027-08-20',
      });

      expect(mockPrisma.recurringExpense.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ recurrenceRule: 'FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=20' }) }),
      );
    });

    it('rejects a category that does not belong to the user', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue(null);
      await expect(
        service.create('u-1', { name: 'x', amount: 100, frequency: 'MONTHLY' as never, firstDueDate: '2026-01-05', categoryId: 'not-mine' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── status classification via findAll ──────────────────────────────────────

  describe('findAll — occurrence status', () => {
    it('marks a past-due, unpaid occurrence as OVERDUE and surfaces the oldest unpaid month first, never silently advancing', async () => {
      freezeNow('2026-09-01T00:00:00.000Z'); // Jan, Feb, ... Aug occurrences have all passed, unpaid
      const re = makeRe();
      mockPrisma.recurringExpense.findMany.mockResolvedValue([re]);
      mockPrisma.recurringExpensePayment.findMany.mockResolvedValue([]);

      const [result] = await service.findAll('u-1');

      expect(result.status).toBe('OVERDUE');
      // The oldest unpaid occurrence (Jan) is surfaced, not Aug (which would silently drop the
      // earlier unpaid months) and not September (which would silently advance past all of them).
      expect(new Date(result.nextDueDate!).toISOString().slice(0, 10)).toBe('2026-01-05');
      expect(result.overdueCount).toBe(8); // Jan through Aug
    });

    it('handles 3 missed weekly periods without collapsing them into one ambiguous date', async () => {
      freezeNow('2026-01-29T00:00:00.000Z'); // 3 Mondays missed: Jan 5, 12, 19, 26
      const re = makeRe({
        frequency: 'WEEKLY',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        firstDueDate: new Date('2026-01-05T00:00:00.000Z'), // a Monday
      });
      mockPrisma.recurringExpense.findMany.mockResolvedValue([re]);
      mockPrisma.recurringExpensePayment.findMany.mockResolvedValue([]);

      const [result] = await service.findAll('u-1');
      // 4 unpaid Mondays have occurred by Jan 29 (5, 12, 19, 26) — all overdue.
      expect(result.overdueCount).toBe(4);
      expect(new Date(result.nextDueDate!).toISOString().slice(0, 10)).toBe('2026-01-05');
    });

    it('excludes an early-paid occurrence from the unpaid list and advances to the following year', async () => {
      freezeNow('2026-08-10T00:00:00.000Z'); // before the Aug 20 due date
      const re = makeRe({
        frequency: 'YEARLY',
        recurrenceRule: 'FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=20',
        firstDueDate: new Date('2026-08-20T00:00:00.000Z'),
      });
      mockPrisma.recurringExpense.findMany.mockResolvedValue([re]);
      // Paid early on Aug 10, for the Aug 20, 2026 occurrence.
      mockPrisma.recurringExpensePayment.findMany.mockResolvedValue([
        { id: 'p1', recurringExpenseId: 're-1', scheduledDueDate: new Date('2026-08-20T00:00:00.000Z'), paidAt: new Date('2026-08-10T00:00:00.000Z'), amount: 1000, currency: 'TWD', expenseId: null, createdAt: new Date() },
      ]);

      const [result] = await service.findAll('u-1');
      // 2026's occurrence is paid and gone; the 2027 occurrence (still >1 year away, well
      // within the 400-day status lookahead) becomes the displayed next-due date. No overdue.
      expect(result.overdueCount).toBe(0);
      expect(result.status).toBe('UPCOMING');
      expect(new Date(result.nextDueDate!).toISOString().slice(0, 10)).toBe('2027-08-20');
    });

    it('shows PAID_AHEAD when no unpaid occurrence exists within the lookahead window at all', async () => {
      freezeNow('2026-08-10T00:00:00.000Z');
      const re = makeRe({
        frequency: 'YEARLY',
        recurrenceRule: 'FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=20;COUNT=1',
        firstDueDate: new Date('2026-08-20T00:00:00.000Z'),
      });
      mockPrisma.recurringExpense.findMany.mockResolvedValue([re]);
      mockPrisma.recurringExpensePayment.findMany.mockResolvedValue([
        { id: 'p1', recurringExpenseId: 're-1', scheduledDueDate: new Date('2026-08-20T00:00:00.000Z'), paidAt: new Date('2026-08-10T00:00:00.000Z'), amount: 1000, currency: 'TWD', expenseId: null, createdAt: new Date() },
      ]);

      const [result] = await service.findAll('u-1');
      expect(result.status).toBe('PAID_AHEAD');
      expect(result.nextDueDate).toBeNull();
    });

    it('marks an occurrence due exactly today as DUE_TODAY', async () => {
      freezeNow('2026-01-05T03:00:00.000Z'); // same Asia/Taipei calendar day as the Jan 5 due date
      const re = makeRe();
      mockPrisma.recurringExpense.findMany.mockResolvedValue([re]);
      mockPrisma.recurringExpensePayment.findMany.mockResolvedValue([]);

      const [result] = await service.findAll('u-1');
      expect(result.status).toBe('DUE_TODAY');
    });
  });

  // ─── markPaid ────────────────────────────────────────────────────────────────

  describe('markPaid', () => {
    it('records payment, creates a linked expense, and keeps recurring by default', async () => {
      const re = makeRe();
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(re);
      const payment = { id: 'pay-1', recurringExpenseId: 're-1', userId: 'u-1', scheduledDueDate: new Date('2026-01-05T00:00:00.000Z'), paidAt: new Date('2026-01-05T00:00:00.000Z'), amount: 10000, currency: 'TWD', expenseId: null, createdAt: new Date() };
      mockPrisma.recurringExpensePayment.create.mockResolvedValue(payment);
      mockFinanceService.createExpense.mockResolvedValue({ id: 'exp-1' });
      mockPrisma.recurringExpensePayment.update.mockResolvedValue({ ...payment, expenseId: 'exp-1' });

      const result = await service.markPaid('u-1', 're-1', { scheduledDueDate: '2026-01-05' });

      expect(mockFinanceService.createExpense).toHaveBeenCalledWith(
        'u-1',
        expect.objectContaining({ amount: 10000, currency: 'TWD' }),
      );
      expect(result.payment.expenseId).toBe('exp-1');
      expect(result.recurringExpenseDeleted).toBe(false);
      expect(mockPrisma.recurringExpense.delete).not.toHaveBeenCalled();
    });

    it('allows marking a future occurrence paid early (before its due date)', async () => {
      freezeNow('2027-08-10T00:00:00.000Z');
      const re = makeRe({ frequency: 'YEARLY', recurrenceRule: 'FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=20', firstDueDate: new Date('2026-08-20T00:00:00.000Z') });
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(re);
      const createdPayment = { id: 'pay-2', recurringExpenseId: 're-1', scheduledDueDate: new Date('2027-08-20T00:00:00.000Z'), paidAt: new Date(), amount: 10000, currency: 'TWD', expenseId: null, createdAt: new Date() };
      mockPrisma.recurringExpensePayment.create.mockResolvedValue(createdPayment);
      mockFinanceService.createExpense.mockResolvedValue({ id: 'exp-2' });
      mockPrisma.recurringExpensePayment.update.mockResolvedValue({ ...createdPayment, expenseId: 'exp-2' });

      const result = await service.markPaid('u-1', 're-1', { scheduledDueDate: '2027-08-20' });
      expect(result.recurringExpenseDeleted).toBe(false);
      expect(mockPrisma.recurringExpensePayment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ scheduledDueDate: new Date('2027-08-20T00:00:00.000Z') }) }),
      );
    });

    it('rejects a scheduledDueDate that is not a real occurrence', async () => {
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(makeRe());
      await expect(
        service.markPaid('u-1', 're-1', { scheduledDueDate: '2026-01-06' }), // Jan 6, rule is day-5
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate payment for the same occurrence (P2002)', async () => {
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(makeRe());
      mockPrisma.recurringExpensePayment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' }),
      );
      await expect(
        service.markPaid('u-1', 're-1', { scheduledDueDate: '2026-01-05' }),
      ).rejects.toThrow(ConflictException);
    });

    it('does not fail the payment if linked-expense creation throws', async () => {
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(makeRe());
      const payment = { id: 'pay-3', recurringExpenseId: 're-1', scheduledDueDate: new Date('2026-01-05T00:00:00.000Z'), paidAt: new Date(), amount: 10000, currency: 'TWD', expenseId: null, createdAt: new Date() };
      mockPrisma.recurringExpensePayment.create.mockResolvedValue(payment);
      mockFinanceService.createExpense.mockRejectedValue(new Error('boom'));

      const result = await service.markPaid('u-1', 're-1', { scheduledDueDate: '2026-01-05' });
      expect(result.payment.expenseId).toBeNull();
    });

    it('skips linked-expense creation when createExpenseTransaction is false', async () => {
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(makeRe());
      mockPrisma.recurringExpensePayment.create.mockResolvedValue({
        id: 'pay-4', recurringExpenseId: 're-1', scheduledDueDate: new Date('2026-01-05T00:00:00.000Z'), paidAt: new Date(), amount: 10000, currency: 'TWD', expenseId: null, createdAt: new Date(),
      });

      await service.markPaid('u-1', 're-1', { scheduledDueDate: '2026-01-05', createExpenseTransaction: false });
      expect(mockFinanceService.createExpense).not.toHaveBeenCalled();
    });

    it('hard-deletes the recurring expense when continueRecurring is false', async () => {
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(makeRe());
      const createdPayment = {
        id: 'pay-5', recurringExpenseId: 're-1', scheduledDueDate: new Date('2026-01-05T00:00:00.000Z'), paidAt: new Date(), amount: 10000, currency: 'TWD', expenseId: null, createdAt: new Date(),
      };
      mockPrisma.recurringExpensePayment.create.mockResolvedValue(createdPayment);
      mockFinanceService.createExpense.mockResolvedValue({ id: 'exp-5' });
      mockPrisma.recurringExpensePayment.update.mockResolvedValue({ ...createdPayment, expenseId: 'exp-5' });

      const result = await service.markPaid('u-1', 're-1', { scheduledDueDate: '2026-01-05', continueRecurring: false });

      expect(mockPrisma.recurringExpense.delete).toHaveBeenCalledWith({ where: { id: 're-1' } });
      expect(result.recurringExpenseDeleted).toBe(true);
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'RECURRING_EXPENSE_DELETED' }),
      );
    });

    it('404s for a recurring expense owned by another user', async () => {
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(null);
      await expect(
        service.markPaid('u-1', 'not-mine', { scheduledDueDate: '2026-01-05' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('leaves recurrenceRule untouched when frequency/firstDueDate are not part of the edit', async () => {
      const existing = makeRe();
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(existing);
      mockPrisma.recurringExpense.update.mockResolvedValue({ ...existing, note: 'updated' });
      mockPrisma.recurringExpensePayment.findMany.mockResolvedValue([]);

      await service.update('u-1', 're-1', { note: 'updated' });

      expect(mockPrisma.recurringExpense.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ recurrenceRule: existing.recurrenceRule }) }),
      );
    });

    it('re-anchors the RRULE when the due day changes, without touching history', async () => {
      const existing = makeRe();
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(existing);
      mockPrisma.recurringExpense.update.mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data }));
      mockPrisma.recurringExpensePayment.findMany.mockResolvedValue([]);

      const result = await service.update('u-1', 're-1', { firstDueDate: '2026-01-10' });

      expect(mockPrisma.recurringExpense.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ recurrenceRule: 'FREQ=MONTHLY;BYMONTHDAY=10' }) }),
      );
      expect(result).toBeDefined();
    });
  });

  // ─── remove ──────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('404s for another user\'s recurring expense', async () => {
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(null);
      await expect(service.remove('u-1', 'not-mine')).rejects.toThrow(NotFoundException);
    });

    it('deletes and publishes an event', async () => {
      mockPrisma.recurringExpense.findFirst.mockResolvedValue(makeRe());
      const result = await service.remove('u-1', 're-1');
      expect(result).toEqual({ success: true });
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'RECURRING_EXPENSE_DELETED' }),
      );
    });
  });

  // ─── getForecast ─────────────────────────────────────────────────────────────

  describe('getForecast', () => {
    it('groups amounts by currency and separates overdue from upcoming', async () => {
      freezeNow('2026-01-01T00:00:00.000Z');
      const rentTWD = makeRe({ id: 're-1', amount: 10000, currency: 'TWD', firstDueDate: new Date('2026-01-05T00:00:00.000Z') });
      const subUSD = makeRe({
        id: 're-2', amount: 10, currency: 'USD',
        frequency: 'WEEKLY', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        firstDueDate: new Date('2025-12-01T00:00:00.000Z'), // a Monday, already overdue by Jan 1
      });
      mockPrisma.recurringExpense.findMany.mockResolvedValue([rentTWD, subUSD]);
      mockPrisma.recurringExpensePayment.findMany.mockResolvedValue([]);

      const forecast = await service.getForecast('u-1', 30);

      expect(forecast.next30Days.amountsByCurrency.TWD).toBe(10000);
      expect(forecast.next30Days.amountsByCurrency.USD).toBeGreaterThan(0);
      // 5 unpaid Mondays (Dec 1, 8, 15, 22, 29 2025) have passed by Jan 1, 2026.
      expect(forecast.overdue.count).toBe(5);
      expect(forecast.overdue.amountsByCurrency.USD).toBe(50);
      expect(Array.isArray(forecast.upcoming)).toBe(true);
      expect(forecast.upcoming[0].dueDate <= forecast.upcoming[forecast.upcoming.length - 1].dueDate).toBe(true);
    });

    it('excludes inactive recurring expenses from the forecast', async () => {
      mockPrisma.recurringExpense.findMany.mockResolvedValue([]); // service queries isActive: true
      mockPrisma.recurringExpensePayment.findMany.mockResolvedValue([]);
      const forecast = await service.getForecast('u-1', 30);
      expect(mockPrisma.recurringExpense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
      expect(forecast.upcoming).toEqual([]);
    });
  });
});
