import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FinanceService } from './finance.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';

const dec = (v: number) => ({ toString: () => String(v) });
const makeDate = (y: number, m: number, d = 1) => new Date(y, m - 1, d);

const mockPrisma = {
  incomeSource: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  income: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  expenseCategory: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  expense: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
  budget: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
};

const mockEvents = { publish: jest.fn().mockResolvedValue(undefined) };

describe('FinanceService', () => {
  let service: FinanceService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
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
    it('calculates totals correctly', async () => {
      const incomes = [
        { id: 'i1', amount: dec(30000), source: { name: 'Salary' } },
        { id: 'i2', amount: dec(5000), source: null },
      ];
      const expenses = [
        { id: 'e1', amount: dec(10000), category: { name: 'Rent' } },
        { id: 'e2', amount: dec(3000), category: { name: 'Food' } },
      ];
      mockPrisma.income.findMany.mockResolvedValue(incomes);
      mockPrisma.expense.findMany.mockResolvedValue(expenses);
      mockPrisma.budget.findFirst.mockResolvedValue({
        totalLimit: dec(40000), currency: 'TWD',
      });

      const result = await service.getMonthlyReport('u-1', 6, 2026);

      expect(result.totalIncome).toBe(35000);
      expect(result.totalExpense).toBe(13000);
      expect(result.netSavings).toBe(22000);
      expect(result.expenseByCategory['Rent']).toBe(10000);
      expect(result.incomeBySource['Salary']).toBe(30000);
      expect(result.budgetUsedPercent).toBe(33);
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
        { amount: dec(12000) },
      ];
      mockPrisma.budget.findFirst.mockResolvedValue(budget);
      mockPrisma.expense.findMany.mockResolvedValue(expenses);

      const result = await service.getBudgetStatus('u-1', 6, 2026);

      expect(result.isExceeded).toBe(true);
      expect(result.usedPercent).toBe(120);
    });

    it('throws NotFoundException when no budget exists', async () => {
      mockPrisma.budget.findFirst.mockResolvedValue(null);
      mockPrisma.expense.findMany.mockResolvedValue([]);

      await expect(service.getBudgetStatus('u-1', 6, 2026)).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Cashflow Forecast ────────────────────────────────────────────────────────

  describe('getCashflowForecast', () => {
    it('returns projected savings based on 3-month average', async () => {
      mockPrisma.income.findMany.mockResolvedValue([
        { amount: dec(30000) }, { amount: dec(30000) }, { amount: dec(30000) },
      ]);
      mockPrisma.expense.findMany.mockResolvedValue([
        { amount: dec(15000) }, { amount: dec(15000) }, { amount: dec(15000) },
      ]);

      const result = await service.getCashflowForecast('u-1');

      expect(result.averageMonthlyIncome).toBe(30000);
      expect(result.averageMonthlyExpense).toBe(15000);
      expect(result.projectedMonthlySavings).toBe(15000);
      expect(result.projected6MonthSavings).toBe(90000);
    });

    it('returns explanation when no data', async () => {
      mockPrisma.income.findMany.mockResolvedValue([]);
      mockPrisma.expense.findMany.mockResolvedValue([]);

      const result = await service.getCashflowForecast('u-1');

      expect(result.projectedMonthlySavings).toBe(0);
      expect(result.explanation).toContain('No finance data');
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

  // ─── getAverageMonthly helpers ────────────────────────────────────────────────

  describe('getAverageMonthlyIncome', () => {
    it('returns 3-month average', async () => {
      mockPrisma.income.findMany.mockResolvedValue([
        { amount: dec(30000) }, { amount: dec(30000) },
      ]);
      const avg = await service.getAverageMonthlyIncome('u-1');
      expect(avg).toBeCloseTo(20000, 0);
    });
  });

  describe('getAverageMonthlyExpense', () => {
    const mockDate = makeDate(2026, 6, 15);
    beforeAll(() => jest.useFakeTimers().setSystemTime(mockDate));
    afterAll(() => jest.useRealTimers());

    it('returns 3-month average expense', async () => {
      mockPrisma.expense.findMany.mockResolvedValue([{ amount: dec(15000) }, { amount: dec(9000) }]);
      const avg = await service.getAverageMonthlyExpense('u-1');
      expect(avg).toBeCloseTo(8000, 0);
    });
  });
});
