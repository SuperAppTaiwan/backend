import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceService } from './finance.service.js';
import { FinanceLedgerService } from './finance-ledger.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';

const dec = (v: number) => ({ toString: () => String(v) });
const makeDate = (y: number, m: number, d = 1) => new Date(y, m - 1, d);

const mockPrisma = {
  incomeSource: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  income: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  expenseCategory: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn(), createMany: jest.fn() },
  expense: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  budget: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
};

const mockEvents = { publish: jest.fn().mockResolvedValue(undefined) };
// Empty map by default: existing tests below don't assert on balanceBefore/balanceAfter, and
// mapExpense/mapIncome handle a missing lookup gracefully (null fields) — see the dedicated
// "balance tracking" describe block and finance-ledger.service.spec.ts for the real ledger math.
const mockLedger = {
  computeBalances: jest.fn().mockResolvedValue(new Map()),
  getCurrentBalances: jest.fn().mockResolvedValue({}),
};

describe('FinanceService', () => {
  let service: FinanceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLedger.computeBalances.mockResolvedValue(new Map());
    mockLedger.getCurrentBalances.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
        { provide: FinanceLedgerService, useValue: mockLedger },
      ],
    }).compile();

    service = module.get<FinanceService>(FinanceService);
  });

  // ─── Income Source ────────────────────────────────────────────────────────────

  describe('createIncomeSource', () => {
    it('creates an income source and returns mapped result', async () => {
      const source = {
        id: 'src-1', userId: 'u-1', name: 'Salary', type: 'SALARY',
        expectedAmount: dec(30000), currency: 'TWD', isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      };
      mockPrisma.incomeSource.create.mockResolvedValue(source);

      const result = await service.createIncomeSource('u-1', {
        name: 'Salary', type: 'SALARY' as const, expectedAmount: 30000,
      });

      expect(result.name).toBe('Salary');
      expect(result.expectedAmount).toBe('30000');
    });
  });

  // ─── Income ───────────────────────────────────────────────────────────────────

  describe('createIncome', () => {
    it('creates income and publishes INCOME_RECEIVED event', async () => {
      const income = {
        id: 'inc-1', userId: 'u-1', sourceId: null, amount: dec(15000),
        currency: 'TWD', receivedDate: new Date(), note: null, eventId: null,
        createdAt: new Date(), updatedAt: new Date(), source: null,
      };
      mockPrisma.income.create.mockResolvedValue(income);
      // checkBudgetExceeded
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      mockPrisma.expense.findMany.mockResolvedValue([]);

      const result = await service.createIncome('u-1', {
        amount: 15000, receivedDate: '2026-06-15',
      });

      expect(result.amount).toBe('15000');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'INCOME_RECEIVED' }),
      );
    });
  });

  // ─── Expense ─────────────────────────────────────────────────────────────────

  describe('createExpense', () => {
    it('creates expense and publishes EXPENSE_CREATED event', async () => {
      const expense = {
        id: 'exp-1', userId: 'u-1', categoryId: null, amount: dec(1200),
        currency: 'TWD', expenseDate: new Date(), paymentMethod: 'CASH',
        sourceModule: 'manual', sourceEntityId: null, note: null, eventId: null,
        createdAt: new Date(), updatedAt: new Date(), category: null,
      };
      mockPrisma.expense.create.mockResolvedValue(expense);
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      mockPrisma.expense.findMany.mockResolvedValue([expense]);

      await service.createExpense('u-1', {
        amount: 1200, expenseDate: '2026-06-10', paymentMethod: 'CASH' as const,
      });

      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'EXPENSE_CREATED' }),
      );
    });

    it('publishes BUDGET_EXCEEDED when total expenses exceed budget limit', async () => {
      const expense = {
        id: 'exp-1', userId: 'u-1', categoryId: null, amount: dec(45000),
        currency: 'TWD', expenseDate: new Date(), paymentMethod: 'BANK',
        sourceModule: 'manual', sourceEntityId: null, note: null, eventId: null,
        createdAt: new Date(), updatedAt: new Date(), category: null,
      };
      const budget = {
        id: 'bud-1', userId: 'u-1', month: new Date().getMonth() + 1, year: new Date().getFullYear(),
        totalLimit: dec(40000), currency: 'TWD', categoryLimitsJson: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      mockPrisma.expense.create.mockResolvedValue(expense);
      mockPrisma.budget.findFirst.mockResolvedValue(budget);
      mockPrisma.expense.findMany.mockResolvedValue([expense]);

      await service.createExpense('u-1', {
        amount: 45000, expenseDate: new Date().toISOString(), paymentMethod: 'BANK' as const,
      });

      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'BUDGET_EXCEEDED' }),
      );
    });
  });

  // ─── Budget ───────────────────────────────────────────────────────────────────

  describe('createBudget', () => {
    it('creates budget and publishes BUDGET_CREATED event', async () => {
      const budget = {
        id: 'bud-1', userId: 'u-1', month: 6, year: 2026,
        totalLimit: dec(40000), currency: 'TWD', categoryLimitsJson: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      mockPrisma.budget.create.mockResolvedValue(budget);

      const result = await service.createBudget('u-1', { month: 6, year: 2026, totalLimit: 40000 });

      expect(result.totalLimit).toBe('40000');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'BUDGET_CREATED' }),
      );
    });

    it('throws ConflictException if budget already exists for month/year', async () => {
      mockPrisma.budget.findFirst.mockResolvedValue({ id: 'bud-existing' });

      await expect(
        service.createBudget('u-1', { month: 6, year: 2026, totalLimit: 40000 }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateBudget', () => {
    it('updates budget and publishes BUDGET_UPDATED event', async () => {
      const budget = {
        id: 'bud-1', userId: 'u-1', month: 6, year: 2026,
        totalLimit: dec(50000), currency: 'TWD', categoryLimitsJson: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      mockPrisma.budget.findFirst.mockResolvedValue(budget);
      mockPrisma.budget.update.mockResolvedValue({ ...budget, totalLimit: dec(50000) });

      await service.updateBudget('u-1', 'bud-1', { totalLimit: 50000 });

      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'BUDGET_UPDATED' }),
      );
    });
  });

  // ─── Monthly Report ───────────────────────────────────────────────────────────

  describe('getMonthlyReport', () => {
    it('calculates totals correctly for a single-currency user', async () => {
      const incomes = [
        { id: 'i1', amount: dec(30000), currency: 'TWD', source: { name: 'Salary' } },
        { id: 'i2', amount: dec(5000), currency: 'TWD', source: null },
      ];
      const expenses = [
        { id: 'e1', amount: dec(10000), currency: 'TWD', category: { name: 'Rent' } },
        { id: 'e2', amount: dec(3000), currency: 'TWD', category: { name: 'Food' } },
      ];
      mockPrisma.income.findMany.mockResolvedValue(incomes);
      mockPrisma.expense.findMany.mockResolvedValue(expenses);
      mockPrisma.budget.findFirst.mockResolvedValue({
        totalLimit: dec(40000), currency: 'TWD',
      });
      mockLedger.getCurrentBalances.mockResolvedValue({ TWD: 22000 });

      const result = await service.getMonthlyReport('u-1', 6, 2026);

      const twd = result.currencies['TWD'];
      expect(twd.totalIncome).toBe(35000);
      expect(twd.totalExpense).toBe(13000);
      expect(twd.netSavings).toBe(22000);
      expect(twd.currentBalance).toBe(22000);
      expect(twd.expenseByCategory['Rent']).toBe(10000);
      expect(twd.incomeBySource['Salary']).toBe(30000);
      expect(twd.budgetUsedPercent).toBe(33);
    });

    it('keeps VND and TWD completely separate, never summed together', async () => {
      const incomes = [
        { id: 'i1', amount: dec(60000000), currency: 'VND', source: null },
        { id: 'i2', amount: dec(10000), currency: 'TWD', source: null },
      ];
      const expenses = [
        { id: 'e1', amount: dec(5000000), currency: 'VND', category: null },
        { id: 'e2', amount: dec(2000), currency: 'TWD', category: null },
      ];
      mockPrisma.income.findMany.mockResolvedValue(incomes);
      mockPrisma.expense.findMany.mockResolvedValue(expenses);
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      mockLedger.getCurrentBalances.mockResolvedValue({ VND: 55000000, TWD: 8000 });

      const result = await service.getMonthlyReport('u-1', 6, 2026);

      expect(Object.keys(result.currencies).sort()).toEqual(['TWD', 'VND']);
      expect(result.currencies['VND'].totalIncome).toBe(60000000);
      expect(result.currencies['VND'].totalExpense).toBe(5000000);
      expect(result.currencies['VND'].currentBalance).toBe(55000000);
      expect(result.currencies['TWD'].totalIncome).toBe(10000);
      expect(result.currencies['TWD'].totalExpense).toBe(2000);
      expect(result.currencies['TWD'].currentBalance).toBe(8000);
      // Never 60000000 + 10000 or any cross-currency sum.
      expect(result.currencies['VND'].totalIncome).not.toBe(60010000);
    });

    it('reports a currency\'s real all-time balance even with zero activity this month', async () => {
      // August had VND activity; September (the queried month) has none — the balance must
      // still show, continuous from August, not disappear/reset to 0.
      mockPrisma.income.findMany.mockResolvedValue([]);
      mockPrisma.expense.findMany.mockResolvedValue([]);
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      mockLedger.getCurrentBalances.mockResolvedValue({ VND: 92000000 });

      const result = await service.getMonthlyReport('u-1', 9, 2026);

      expect(result.currencies['VND'].currentBalance).toBe(92000000);
      expect(result.currencies['VND'].totalIncome).toBe(0);
      expect(result.currencies['VND'].totalExpense).toBe(0);
    });

    it('continues the cumulative balance across a month boundary (August -> September example)', async () => {
      // August ending balance 92,000,000 VND. September: +10,000,000 income, -5,000,000 expense.
      mockPrisma.income.findMany.mockResolvedValue([{ id: 'i1', amount: dec(10000000), currency: 'VND', source: null }]);
      mockPrisma.expense.findMany.mockResolvedValue([{ id: 'e1', amount: dec(5000000), currency: 'VND', category: null }]);
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      // The ledger's all-time balance already reflects August + September's transactions.
      mockLedger.getCurrentBalances.mockResolvedValue({ VND: 97000000 });

      const result = await service.getMonthlyReport('u-1', 9, 2026);

      expect(result.currencies['VND'].currentBalance).toBe(97000000);
      expect(result.currencies['VND'].totalIncome).toBe(10000000);
      expect(result.currencies['VND'].totalExpense).toBe(5000000);
      expect(result.currencies['VND'].netSavings).toBe(5000000);
    });
  });

  // ─── Budget Status ────────────────────────────────────────────────────────────

  describe('getBudgetStatus', () => {
    it('detects exceeded budget', async () => {
      const budget = {
        id: 'bud-1', userId: 'u-1', month: 6, year: 2026,
        totalLimit: dec(10000), currency: 'TWD', categoryLimitsJson: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      const expenses = [
        { amount: dec(12000), currency: 'TWD' },
      ];
      mockPrisma.budget.findFirst.mockResolvedValue(budget);
      mockPrisma.expense.findMany.mockResolvedValue(expenses);

      const result = await service.getBudgetStatus('u-1', 6, 2026);

      expect(result.isExceeded).toBe(true);
      expect(result.usedPercent).toBe(120);
    });

    it('ignores expenses in a different currency than the budget', async () => {
      const budget = {
        id: 'bud-1', userId: 'u-1', month: 6, year: 2026,
        totalLimit: dec(10000), currency: 'TWD', categoryLimitsJson: null,
        createdAt: new Date(), updatedAt: new Date(),
      };
      const expenses = [
        { amount: dec(12000), currency: 'TWD' },
        { amount: dec(50000000), currency: 'VND' },
      ];
      mockPrisma.budget.findFirst.mockResolvedValue(budget);
      mockPrisma.expense.findMany.mockResolvedValue(expenses);

      const result = await service.getBudgetStatus('u-1', 6, 2026);

      // The VND expense must have zero effect on a TWD budget's totals.
      expect(result.totalExpense).toBe(12000);
      expect(result.isExceeded).toBe(true);
    });

    it('returns empty status when no budget exists', async () => {
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      mockPrisma.expense.findMany.mockResolvedValue([]);

      const result = await service.getBudgetStatus('u-1', 6, 2026);
      expect(result.budget).toBeNull();
      expect(result.totalExpense).toBe(0);
      expect(result.usedPercent).toBe(0);
      expect(result.isExceeded).toBe(false);
    });
  });

  // ─── Cashflow Forecast (finance.service.ts's own — not the one mobile calls, see ai.service.spec.ts) ──

  describe('getCashflowForecast', () => {
    it('returns projected savings based on 3-month average', async () => {
      mockPrisma.income.findMany.mockResolvedValue([
        { amount: dec(30000), currency: 'TWD' }, { amount: dec(30000), currency: 'TWD' }, { amount: dec(30000), currency: 'TWD' },
      ]);
      mockPrisma.expense.findMany.mockResolvedValue([
        { amount: dec(15000), currency: 'TWD' }, { amount: dec(15000), currency: 'TWD' }, { amount: dec(15000), currency: 'TWD' },
      ]);

      const result = await service.getCashflowForecast('u-1');

      expect(result.currencies['TWD'].averageMonthlyIncome).toBe(30000);
      expect(result.currencies['TWD'].averageMonthlyExpense).toBe(15000);
      expect(result.currencies['TWD'].projectedMonthlySavings).toBe(15000);
      expect(result.currencies['TWD'].projected6MonthSavings).toBe(90000);
    });

    it('keeps each currency projection fully independent', async () => {
      mockPrisma.income.findMany.mockResolvedValue([
        { amount: dec(90000000), currency: 'VND' },
        { amount: dec(30000), currency: 'TWD' },
      ]);
      mockPrisma.expense.findMany.mockResolvedValue([
        { amount: dec(15000000), currency: 'VND' },
        { amount: dec(9000), currency: 'TWD' },
      ]);

      const result = await service.getCashflowForecast('u-1');

      expect(result.currencies['VND'].averageMonthlyIncome).toBe(30000000);
      expect(result.currencies['TWD'].averageMonthlyIncome).toBe(10000);
      expect(result.currencies['VND'].averageMonthlyIncome).not.toBe(result.currencies['TWD'].averageMonthlyIncome);
    });

    it('returns explanation when no data', async () => {
      mockPrisma.income.findMany.mockResolvedValue([]);
      mockPrisma.expense.findMany.mockResolvedValue([]);

      const result = await service.getCashflowForecast('u-1');

      expect(result.explanation).toContain('No finance data');
      expect(Object.keys(result.currencies)).toHaveLength(0);
    });
  });

  // ─── Monthly Trend ────────────────────────────────────────────────────────────

  describe('getMonthlyTrend', () => {
    it('buckets income/expense into the correct trailing month and computes net savings', async () => {
      const now = new Date();
      const thisMonth = makeDate(now.getFullYear(), now.getMonth() + 1, 10);
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 10);
      const lastMonth = makeDate(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 10);

      mockPrisma.income.findMany.mockResolvedValue([
        { amount: dec(20000), currency: 'TWD', receivedDate: thisMonth },
        { amount: dec(10000), currency: 'TWD', receivedDate: lastMonth },
      ]);
      mockPrisma.expense.findMany.mockResolvedValue([
        { amount: dec(5000), currency: 'TWD', expenseDate: thisMonth },
        { amount: dec(4000), currency: 'TWD', expenseDate: lastMonth },
      ]);

      const result = await service.getMonthlyTrend('u-1', 3);

      expect(result).toHaveLength(3);
      const current = result[result.length - 1].currencies['TWD'];
      const previous = result[result.length - 2].currencies['TWD'];
      expect(current.totalIncome).toBe(20000);
      expect(current.totalExpense).toBe(5000);
      expect(current.netSavings).toBe(15000);
      expect(previous.totalIncome).toBe(10000);
      expect(previous.totalExpense).toBe(4000);
      expect(previous.netSavings).toBe(6000);
    });

    it('keeps VND and TWD in separate per-bucket entries, never combined', async () => {
      const now = new Date();
      const thisMonth = makeDate(now.getFullYear(), now.getMonth() + 1, 10);

      mockPrisma.income.findMany.mockResolvedValue([
        { amount: dec(60000000), currency: 'VND', receivedDate: thisMonth },
        { amount: dec(10000), currency: 'TWD', receivedDate: thisMonth },
      ]);
      mockPrisma.expense.findMany.mockResolvedValue([]);

      const result = await service.getMonthlyTrend('u-1', 1);

      const bucket = result[0];
      expect(bucket.currencies['VND'].totalIncome).toBe(60000000);
      expect(bucket.currencies['TWD'].totalIncome).toBe(10000);
    });

    it('returns an empty currencies map per month when there is no data', async () => {
      mockPrisma.income.findMany.mockResolvedValue([]);
      mockPrisma.expense.findMany.mockResolvedValue([]);

      const result = await service.getMonthlyTrend('u-1', 6);

      expect(result).toHaveLength(6);
      expect(result.every((r) => Object.keys(r.currencies).length === 0)).toBe(true);
    });
  });

  // ─── Ownership enforcement ────────────────────────────────────────────────────

  describe('ownership enforcement', () => {
    it('throws NotFoundException when accessing another users income', async () => {
      mockPrisma.income.findFirst.mockResolvedValue(null);

      await expect(service.findOneIncome('u-1', 'other-income-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when updating another users category', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1', userId: 'u-other' });

      await expect(
        service.updateExpenseCategory('u-1', 'cat-1', { name: 'Hacked' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when accessing another users expense', async () => {
      mockPrisma.expense.findFirst.mockResolvedValue(null);

      await expect(service.findOneExpense('u-1', 'other-exp-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Expense categories ────────────────────────────────────────────────────────

  describe('expense categories', () => {
    it('creates a category with icon and color', async () => {
      mockPrisma.expenseCategory.create.mockResolvedValue({
        id: 'cat-1', userId: 'u-1', name: 'Ăn vặt', type: 'FOOD',
        icon: 'ice-cream-outline', color: '#F0647D',
        isDefault: false, isArchived: false, createdAt: new Date(), updatedAt: new Date(),
      });

      const result = await service.createExpenseCategory('u-1', {
        name: 'Ăn vặt', type: 'FOOD' as never, icon: 'ice-cream-outline', color: '#F0647D',
      });

      expect(result.icon).toBe('ice-cream-outline');
      expect(result.color).toBe('#F0647D');
    });

    it('lazily seeds the default categories once, on first list request', async () => {
      mockPrisma.expenseCategory.count.mockResolvedValue(0);
      mockPrisma.expenseCategory.findMany.mockResolvedValue([]);

      await service.findAllExpenseCategories('u-1');

      expect(mockPrisma.expenseCategory.createMany).toHaveBeenCalledTimes(1);
      const seeded = mockPrisma.expenseCategory.createMany.mock.calls[0][0].data as { userId: null; isDefault: boolean }[];
      expect(seeded.length).toBeGreaterThan(0);
      expect(seeded.every((c) => c.userId === null && c.isDefault === true)).toBe(true);
    });

    it('does not reseed default categories once they already exist', async () => {
      mockPrisma.expenseCategory.count.mockResolvedValue(9);
      mockPrisma.expenseCategory.findMany.mockResolvedValue([]);

      await service.findAllExpenseCategories('u-1');

      expect(mockPrisma.expenseCategory.createMany).not.toHaveBeenCalled();
    });

    it('excludes archived categories from the default list', async () => {
      mockPrisma.expenseCategory.count.mockResolvedValue(9);
      mockPrisma.expenseCategory.findMany.mockResolvedValue([]);

      await service.findAllExpenseCategories('u-1');

      expect(mockPrisma.expenseCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isArchived: false }) }),
      );
    });

    it('hard-deletes a category with no historical expenses referencing it', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1', userId: 'u-1' });
      mockPrisma.expense.count.mockResolvedValue(0);

      const result = await service.removeExpenseCategory('u-1', 'cat-1');

      expect(mockPrisma.expenseCategory.delete).toHaveBeenCalledWith({ where: { id: 'cat-1' } });
      expect(mockPrisma.expenseCategory.update).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, archived: false });
    });

    it('archives (does not hard-delete) a category still referenced by historical expenses', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1', userId: 'u-1' });
      mockPrisma.expense.count.mockResolvedValue(3);

      const result = await service.removeExpenseCategory('u-1', 'cat-1');

      expect(mockPrisma.expenseCategory.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: { isArchived: true },
      });
      expect(mockPrisma.expenseCategory.delete).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, archived: true });
    });

    it('throws ForbiddenException when deleting another users category', async () => {
      mockPrisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1', userId: 'u-other' });

      await expect(service.removeExpenseCategory('u-1', 'cat-1')).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.expense.count).not.toHaveBeenCalled();
    });
  });

  // ─── getAverageMonthly helpers ────────────────────────────────────────────────

  describe('getAverageMonthlyIncome', () => {
    it('returns 3-month average', async () => {
      mockPrisma.income.findMany.mockResolvedValue([
        { amount: dec(30000) }, { amount: dec(30000) },
      ]);
      const avg = await service.getAverageMonthlyIncome('u-1', 'TWD');
      expect(avg).toBeCloseTo(20000, 0);
    });

    it('filters the query by the given currency, at the database level', async () => {
      mockPrisma.income.findMany.mockResolvedValue([]);
      await service.getAverageMonthlyIncome('u-1', 'VND');
      expect(mockPrisma.income.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ currency: 'VND' }) }),
      );
    });
  });

  describe('getAverageMonthlyExpense', () => {
    const mockDate = makeDate(2026, 6, 15);
    beforeAll(() => jest.useFakeTimers().setSystemTime(mockDate));
    afterAll(() => jest.useRealTimers());

    it('returns 3-month average expense', async () => {
      mockPrisma.expense.findMany.mockResolvedValue([{ amount: dec(15000) }, { amount: dec(9000) }]);
      const avg = await service.getAverageMonthlyExpense('u-1', 'TWD');
      expect(avg).toBeCloseTo(8000, 0);
    });

    it('filters the query by the given currency, at the database level', async () => {
      mockPrisma.expense.findMany.mockResolvedValue([]);
      await service.getAverageMonthlyExpense('u-1', 'VND');
      expect(mockPrisma.expense.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ currency: 'VND' }) }),
      );
    });
  });

  // ─── Balance tracking (before/after) ───────────────────────────────────────────
  // The actual running-balance math is unit-tested in finance-ledger.service.spec.ts — these
  // tests only prove FinanceService correctly wires the ledger's result into every response.

  describe('balance tracking wiring', () => {
    it('includes balanceBefore/balanceAfter on a newly created expense', async () => {
      const expense = {
        id: 'exp-1', userId: 'u-1', categoryId: null, amount: dec(500),
        currency: 'TWD', expenseDate: new Date(), paymentMethod: 'CASH',
        sourceModule: 'manual', sourceEntityId: null, note: null, eventId: null,
        createdAt: new Date(), updatedAt: new Date(), category: null,
      };
      mockPrisma.expense.create.mockResolvedValue(expense);
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      mockPrisma.expense.findMany.mockResolvedValue([expense]);
      mockLedger.computeBalances.mockResolvedValue(new Map([['exp-1', { balanceBefore: 10000, balanceAfter: 9500 }]]));

      const result = await service.createExpense('u-1', {
        amount: 500, expenseDate: '2026-06-10', paymentMethod: 'CASH' as const,
      });

      expect(result.balanceBefore).toBe('10000');
      expect(result.balanceAfter).toBe('9500');
    });

    it('includes balanceBefore/balanceAfter on a newly created income', async () => {
      const income = {
        id: 'inc-1', userId: 'u-1', sourceId: null, amount: dec(20000),
        currency: 'TWD', receivedDate: new Date(), note: null, eventId: null,
        createdAt: new Date(), updatedAt: new Date(), source: null,
      };
      mockPrisma.income.create.mockResolvedValue(income);
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      mockPrisma.expense.findMany.mockResolvedValue([]);
      mockLedger.computeBalances.mockResolvedValue(new Map([['inc-1', { balanceBefore: 5000, balanceAfter: 25000 }]]));

      const result = await service.createIncome('u-1', { amount: 20000, receivedDate: '2026-06-15' });

      expect(result.balanceBefore).toBe('5000');
      expect(result.balanceAfter).toBe('25000');
    });

    it('annotates every row in findAllExpenses from a single computeBalances call (no N+1)', async () => {
      const expenses = [
        { id: 'e1', userId: 'u-1', categoryId: null, amount: dec(200), currency: 'TWD', expenseDate: new Date(), paymentMethod: 'CASH', sourceModule: 'manual', note: null, createdAt: new Date(), updatedAt: new Date(), category: null },
        { id: 'e2', userId: 'u-1', categoryId: null, amount: dec(100), currency: 'TWD', expenseDate: new Date(), paymentMethod: 'CASH', sourceModule: 'manual', note: null, createdAt: new Date(), updatedAt: new Date(), category: null },
      ];
      mockPrisma.expense.findMany.mockResolvedValue(expenses);
      mockLedger.computeBalances.mockResolvedValue(new Map([
        ['e1', { balanceBefore: 1500, balanceAfter: 1300 }],
        ['e2', { balanceBefore: 1300, balanceAfter: 1200 }],
      ]));

      const result = await service.findAllExpenses('u-1');

      expect(result[0].balanceBefore).toBe('1500');
      expect(result[0].balanceAfter).toBe('1300');
      expect(result[1].balanceBefore).toBe('1300');
      expect(result[1].balanceAfter).toBe('1200');
      expect(mockLedger.computeBalances).toHaveBeenCalledTimes(1);
    });

    it('recomputes balances after editing an expense amount', async () => {
      const existing = {
        id: 'e1', userId: 'u-1', categoryId: null, amount: dec(200), currency: 'TWD',
        expenseDate: new Date(), paymentMethod: 'CASH', sourceModule: 'manual', note: null,
        createdAt: new Date(), updatedAt: new Date(), category: null,
      };
      const updated = { ...existing, amount: dec(300) };
      mockPrisma.expense.findFirst.mockResolvedValue(existing);
      mockPrisma.expense.update.mockResolvedValue(updated);
      // The recomputed map reflects the NEW amount (300, not 200) — proves the service asks for
      // a fresh computeBalances after the mutation rather than reusing an earlier snapshot.
      mockLedger.computeBalances.mockResolvedValue(new Map([['e1', { balanceBefore: 1500, balanceAfter: 1200 }]]));

      const result = await service.updateExpense('u-1', 'e1', { amount: 300 });

      expect(result.balanceAfter).toBe('1200');
      expect(mockLedger.computeBalances).toHaveBeenCalledTimes(1);
    });
  });
});
