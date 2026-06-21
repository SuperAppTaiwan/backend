import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { CreateIncomeSourceDto } from './dto/create-income-source.dto.js';
import { UpdateIncomeSourceDto } from './dto/update-income-source.dto.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';
import { UpdateIncomeDto } from './dto/update-income.dto.js';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto.js';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { UpdateExpenseDto } from './dto/update-expense.dto.js';
import { CreateBudgetDto } from './dto/create-budget.dto.js';
import { UpdateBudgetDto } from './dto/update-budget.dto.js';

type DecimalLike = { toString(): string } | null;

function toStr(v: DecimalLike): string | null {
  return v?.toString() ?? null;
}

function toNum(v: DecimalLike): number {
  return v ? parseFloat(v.toString()) : 0;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ─── Income Sources ──────────────────────────────────────────────────────────

  async createIncomeSource(userId: string, dto: CreateIncomeSourceDto) {
    const source = await this.prisma.incomeSource.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        expectedAmount: dto.expectedAmount,
        currency: dto.currency ?? 'TWD',
        isActive: dto.isActive ?? true,
      },
    });
    return this.mapSource(source);
  }

  async findAllIncomeSources(userId: string) {
    const sources = await this.prisma.incomeSource.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return sources.map(this.mapSource);
  }

  async findOneIncomeSource(userId: string, id: string) {
    const source = await this.prisma.incomeSource.findFirst({ where: { id, userId } });
    if (!source) throw new NotFoundException('Income source not found');
    return this.mapSource(source);
  }

  async updateIncomeSource(userId: string, id: string, dto: UpdateIncomeSourceDto) {
    await this.findOneIncomeSource(userId, id);
    const updated = await this.prisma.incomeSource.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.expectedAmount !== undefined && { expectedAmount: dto.expectedAmount }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    return this.mapSource(updated);
  }

  async removeIncomeSource(userId: string, id: string) {
    await this.findOneIncomeSource(userId, id);
    await this.prisma.incomeSource.delete({ where: { id } });
    return { success: true };
  }

  // ─── Incomes ─────────────────────────────────────────────────────────────────

  async createIncome(userId: string, dto: CreateIncomeDto) {
    if (dto.sourceId) {
      const source = await this.prisma.incomeSource.findFirst({
        where: { id: dto.sourceId, userId },
      });
      if (!source) throw new NotFoundException('Income source not found');
    }

    const income = await this.prisma.income.create({
      data: {
        userId,
        sourceId: dto.sourceId,
        amount: dto.amount,
        currency: dto.currency ?? 'TWD',
        receivedDate: new Date(dto.receivedDate),
        note: dto.note,
      },
      include: { source: true },
    });

    await this.events.publish({
      userId,
      eventType: EventType.INCOME_RECEIVED,
      sourceModule: 'finance',
      payload: { incomeId: income.id, amount: dto.amount, currency: income.currency },
    });

    return this.mapIncome(income);
  }

  async findAllIncomes(userId: string) {
    const incomes = await this.prisma.income.findMany({
      where: { userId },
      include: { source: true },
      orderBy: { receivedDate: 'desc' },
    });
    return incomes.map(this.mapIncome);
  }

  async findOneIncome(userId: string, id: string) {
    const income = await this.prisma.income.findFirst({
      where: { id, userId },
      include: { source: true },
    });
    if (!income) throw new NotFoundException('Income not found');
    return this.mapIncome(income);
  }

  async updateIncome(userId: string, id: string, dto: UpdateIncomeDto) {
    await this.findOneIncome(userId, id);
    const updated = await this.prisma.income.update({
      where: { id },
      data: {
        ...(dto.sourceId !== undefined && { sourceId: dto.sourceId }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.receivedDate !== undefined && { receivedDate: new Date(dto.receivedDate) }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
      include: { source: true },
    });

    await this.events.publish({
      userId,
      eventType: EventType.INCOME_UPDATED,
      sourceModule: 'finance',
      payload: { incomeId: id },
    });

    return this.mapIncome(updated);
  }

  async removeIncome(userId: string, id: string) {
    await this.findOneIncome(userId, id);
    await this.prisma.income.delete({ where: { id } });

    await this.events.publish({
      userId,
      eventType: EventType.INCOME_DELETED,
      sourceModule: 'finance',
      payload: { incomeId: id },
    });

    return { success: true };
  }

  // ─── Expense Categories ──────────────────────────────────────────────────────

  async createExpenseCategory(userId: string, dto: CreateExpenseCategoryDto) {
    const cat = await this.prisma.expenseCategory.create({
      data: {
        userId,
        name: dto.name,
        type: dto.type,
        isDefault: dto.isDefault ?? false,
      },
    });
    return this.mapCategory(cat);
  }

  async findAllExpenseCategories(userId: string) {
    const cats = await this.prisma.expenseCategory.findMany({
      where: { OR: [{ userId }, { isDefault: true }] },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return cats.map(this.mapCategory);
  }

  async updateExpenseCategory(userId: string, id: string, dto: UpdateExpenseCategoryDto) {
    const cat = await this.prisma.expenseCategory.findFirst({ where: { id } });
    if (!cat) throw new NotFoundException('Expense category not found');
    if (cat.userId !== userId) throw new ForbiddenException('Not your category');

    const updated = await this.prisma.expenseCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.type !== undefined && { type: dto.type }),
      },
    });
    return this.mapCategory(updated);
  }

  async removeExpenseCategory(userId: string, id: string) {
    const cat = await this.prisma.expenseCategory.findFirst({ where: { id } });
    if (!cat) throw new NotFoundException('Expense category not found');
    if (cat.userId !== userId) throw new ForbiddenException('Not your category');
    await this.prisma.expenseCategory.delete({ where: { id } });
    return { success: true };
  }

  // ─── Expenses ────────────────────────────────────────────────────────────────

  async createExpense(userId: string, dto: CreateExpenseDto) {
    const expense = await this.prisma.expense.create({
      data: {
        userId,
        categoryId: dto.categoryId,
        amount: dto.amount,
        currency: dto.currency ?? 'TWD',
        expenseDate: new Date(dto.expenseDate),
        paymentMethod: dto.paymentMethod,
        note: dto.note,
      },
      include: { category: true },
    });

    await this.events.publish({
      userId,
      eventType: EventType.EXPENSE_CREATED,
      sourceModule: 'finance',
      payload: { expenseId: expense.id, amount: dto.amount, currency: expense.currency },
    });

    await this.checkBudgetExceeded(userId, expense.currency);

    return this.mapExpense(expense);
  }

  async findAllExpenses(userId: string) {
    const expenses = await this.prisma.expense.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { expenseDate: 'desc' },
    });
    return expenses.map(this.mapExpense);
  }

  async findOneExpense(userId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, userId },
      include: { category: true },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return this.mapExpense(expense);
  }

  async updateExpense(userId: string, id: string, dto: UpdateExpenseDto) {
    await this.findOneExpense(userId, id);
    const updated = await this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.expenseDate !== undefined && { expenseDate: new Date(dto.expenseDate) }),
        ...(dto.paymentMethod !== undefined && { paymentMethod: dto.paymentMethod }),
        ...(dto.note !== undefined && { note: dto.note }),
      },
      include: { category: true },
    });

    await this.events.publish({
      userId,
      eventType: EventType.EXPENSE_UPDATED,
      sourceModule: 'finance',
      payload: { expenseId: id },
    });

    return this.mapExpense(updated);
  }

  async removeExpense(userId: string, id: string) {
    await this.findOneExpense(userId, id);
    await this.prisma.expense.delete({ where: { id } });

    await this.events.publish({
      userId,
      eventType: EventType.EXPENSE_DELETED,
      sourceModule: 'finance',
      payload: { expenseId: id },
    });

    return { success: true };
  }

  // ─── Budgets ─────────────────────────────────────────────────────────────────

  async createBudget(userId: string, dto: CreateBudgetDto) {
    const existing = await this.prisma.budget.findFirst({
      where: { userId, month: dto.month, year: dto.year },
    });
    if (existing) {
      throw new ConflictException(`Budget for ${dto.month}/${dto.year} already exists`);
    }

    const budget = await this.prisma.budget.create({
      data: {
        userId,
        month: dto.month,
        year: dto.year,
        totalLimit: dto.totalLimit,
        currency: dto.currency ?? 'TWD',
        categoryLimitsJson: dto.categoryLimitsJson as Prisma.InputJsonValue,
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.BUDGET_CREATED,
      sourceModule: 'finance',
      payload: { budgetId: budget.id, month: dto.month, year: dto.year },
    });

    return this.mapBudget(budget);
  }

  async findAllBudgets(userId: string) {
    const budgets = await this.prisma.budget.findMany({
      where: { userId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return budgets.map(this.mapBudget);
  }

  async findCurrentBudget(userId: string) {
    const now = new Date();
    const budget = await this.prisma.budget.findFirst({
      where: { userId, month: now.getMonth() + 1, year: now.getFullYear() },
    });
    if (!budget) throw new NotFoundException('No budget set for current month');
    return this.mapBudget(budget);
  }

  async updateBudget(userId: string, id: string, dto: UpdateBudgetDto) {
    const budget = await this.prisma.budget.findFirst({ where: { id, userId } });
    if (!budget) throw new NotFoundException('Budget not found');

    const updated = await this.prisma.budget.update({
      where: { id },
      data: {
        ...(dto.totalLimit !== undefined && { totalLimit: dto.totalLimit }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.categoryLimitsJson !== undefined && {
          categoryLimitsJson: dto.categoryLimitsJson as Prisma.InputJsonValue,
        }),
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.BUDGET_UPDATED,
      sourceModule: 'finance',
      payload: { budgetId: id },
    });

    return this.mapBudget(updated);
  }

  async removeBudget(userId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({ where: { id, userId } });
    if (!budget) throw new NotFoundException('Budget not found');
    await this.prisma.budget.delete({ where: { id } });

    await this.events.publish({
      userId,
      eventType: EventType.BUDGET_DELETED,
      sourceModule: 'finance',
      payload: { budgetId: id },
    });

    return { success: true };
  }

  // ─── Reports ─────────────────────────────────────────────────────────────────

  async getMonthlyReport(userId: string, month: number, year: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const [incomes, expenses, budget] = await Promise.all([
      this.prisma.income.findMany({
        where: { userId, receivedDate: { gte: start, lt: end } },
        include: { source: true },
      }),
      this.prisma.expense.findMany({
        where: { userId, expenseDate: { gte: start, lt: end } },
        include: { category: true },
      }),
      this.prisma.budget.findFirst({ where: { userId, month, year } }),
    ]);

    const totalIncome = incomes.reduce((sum, i) => sum + toNum(i.amount), 0);
    const totalExpense = expenses.reduce((sum, e) => sum + toNum(e.amount), 0);
    const netSavings = totalIncome - totalExpense;

    const expenseByCategory: Record<string, number> = {};
    for (const e of expenses) {
      const key = e.category?.name ?? 'Uncategorized';
      expenseByCategory[key] = (expenseByCategory[key] ?? 0) + toNum(e.amount);
    }

    const incomeBySource: Record<string, number> = {};
    for (const i of incomes) {
      const key = i.source?.name ?? 'Other';
      incomeBySource[key] = (incomeBySource[key] ?? 0) + toNum(i.amount);
    }

    const budgetLimit = budget ? toNum(budget.totalLimit) : null;
    const budgetUsedPercent =
      budgetLimit && budgetLimit > 0
        ? Math.round((totalExpense / budgetLimit) * 100)
        : null;

    return {
      month,
      year,
      currency: budget?.currency ?? 'TWD',
      totalIncome,
      totalExpense,
      netSavings,
      expenseByCategory,
      incomeBySource,
      budgetLimit,
      budgetUsedPercent,
    };
  }

  async getBudgetStatus(userId: string, month: number, year: number) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const [budget, expenses] = await Promise.all([
      this.prisma.budget.findFirst({ where: { userId, month, year } }),
      this.prisma.expense.findMany({ where: { userId, expenseDate: { gte: start, lt: end } } }),
    ]);

    if (!budget) throw new NotFoundException('No budget set for the specified month');

    const totalExpense = expenses.reduce((sum, e) => sum + toNum(e.amount), 0);
    const budgetLimit = toNum(budget.totalLimit);
    const remainingBudget = budgetLimit - totalExpense;
    const usedPercent = budgetLimit > 0 ? Math.round((totalExpense / budgetLimit) * 100) : 0;

    return {
      budget: this.mapBudget(budget),
      totalExpense,
      remainingBudget,
      usedPercent,
      isExceeded: totalExpense > budgetLimit,
    };
  }

  async getCashflowForecast(userId: string) {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [incomes, expenses] = await Promise.all([
      this.prisma.income.findMany({
        where: { userId, receivedDate: { gte: threeMonthsAgo, lt: thisMonthStart } },
      }),
      this.prisma.expense.findMany({
        where: { userId, expenseDate: { gte: threeMonthsAgo, lt: thisMonthStart } },
      }),
    ]);

    const totalIncome = incomes.reduce((sum, i) => sum + toNum(i.amount), 0);
    const totalExpense = expenses.reduce((sum, e) => sum + toNum(e.amount), 0);
    const avgMonthlyIncome = totalIncome / 3;
    const avgMonthlyExpense = totalExpense / 3;
    const projectedMonthlySavings = avgMonthlyIncome - avgMonthlyExpense;
    const projected6MonthSavings = projectedMonthlySavings * 6;

    let explanation: string;
    if (incomes.length === 0 && expenses.length === 0) {
      explanation = 'No finance data in the past 3 months. Record income and expenses to get a forecast.';
    } else if (projectedMonthlySavings <= 0) {
      explanation = `Your expenses (avg ${avgMonthlyExpense.toFixed(0)} TWD/mo) exceed income (avg ${avgMonthlyIncome.toFixed(0)} TWD/mo). Consider reducing expenses.`;
    } else {
      explanation = `Based on the past 3 months, you save an average of ${projectedMonthlySavings.toFixed(0)} TWD per month.`;
    }

    return {
      basedOnMonths: 3,
      averageMonthlyIncome: Math.round(avgMonthlyIncome),
      averageMonthlyExpense: Math.round(avgMonthlyExpense),
      projectedMonthlySavings: Math.round(projectedMonthlySavings),
      projected6MonthSavings: Math.round(projected6MonthSavings),
      explanation,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  async getAverageMonthlyIncome(userId: string): Promise<number> {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const incomes = await this.prisma.income.findMany({
      where: { userId, receivedDate: { gte: threeMonthsAgo, lt: thisMonthStart } },
    });
    const total = incomes.reduce((sum, i) => sum + toNum(i.amount), 0);
    return total / 3;
  }

  async getAverageMonthlyExpense(userId: string): Promise<number> {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const expenses = await this.prisma.expense.findMany({
      where: { userId, expenseDate: { gte: threeMonthsAgo, lt: thisMonthStart } },
    });
    const total = expenses.reduce((sum, e) => sum + toNum(e.amount), 0);
    return total / 3;
  }

  private async checkBudgetExceeded(userId: string, currency: string) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const [budget, expenses] = await Promise.all([
      this.prisma.budget.findFirst({ where: { userId, month, year } }),
      this.prisma.expense.findMany({ where: { userId, expenseDate: { gte: start, lt: end } } }),
    ]);

    if (!budget) return;

    const totalExpense = expenses.reduce((sum, e) => sum + toNum(e.amount), 0);
    if (totalExpense > toNum(budget.totalLimit)) {
      await this.events.publish({
        userId,
        eventType: EventType.BUDGET_EXCEEDED,
        sourceModule: 'finance',
        payload: { month, year, totalExpense, limit: toNum(budget.totalLimit), currency },
      });
    }
  }

  // ─── Mappers ─────────────────────────────────────────────────────────────────

  private mapSource(s: {
    id: string; userId: string; name: string; type: string;
    expectedAmount: DecimalLike; currency: string; isActive: boolean;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: s.id, userId: s.userId, name: s.name, type: s.type,
      expectedAmount: toStr(s.expectedAmount), currency: s.currency,
      isActive: s.isActive, createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private mapIncome(i: {
    id: string; userId: string; sourceId: string | null; amount: DecimalLike;
    currency: string; receivedDate: Date; note: string | null; eventId: string | null;
    createdAt: Date; updatedAt: Date;
    source?: { id: string; name: string } | null;
  }) {
    return {
      id: i.id, userId: i.userId, sourceId: i.sourceId,
      amount: toStr(i.amount), currency: i.currency,
      receivedDate: i.receivedDate.toISOString(), note: i.note,
      sourceName: i.source?.name ?? null,
      createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString(),
    };
  }

  private mapCategory(c: {
    id: string; userId: string | null; name: string; type: string;
    isDefault: boolean; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: c.id, userId: c.userId, name: c.name, type: c.type,
      isDefault: c.isDefault, createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private mapExpense(e: {
    id: string; userId: string; categoryId: string | null; amount: DecimalLike;
    currency: string; expenseDate: Date; paymentMethod: string; sourceModule: string;
    note: string | null; createdAt: Date; updatedAt: Date;
    category?: { id: string; name: string } | null;
  }) {
    return {
      id: e.id, userId: e.userId, categoryId: e.categoryId,
      amount: toStr(e.amount), currency: e.currency,
      expenseDate: e.expenseDate.toISOString(), paymentMethod: e.paymentMethod,
      sourceModule: e.sourceModule, note: e.note,
      categoryName: e.category?.name ?? null,
      createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString(),
    };
  }

  private mapBudget(b: {
    id: string; userId: string; month: number; year: number;
    totalLimit: DecimalLike; currency: string; categoryLimitsJson: unknown;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: b.id, userId: b.userId, month: b.month, year: b.year,
      totalLimit: toStr(b.totalLimit), currency: b.currency,
      categoryLimitsJson: b.categoryLimitsJson,
      createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
    };
  }
}
