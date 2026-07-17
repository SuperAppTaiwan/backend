import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AIService } from './ai.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { DeterministicAIProvider } from './providers/deterministic-ai.provider.js';
import { GeminiAIProvider } from './providers/gemini-ai.provider.js';
import { AIProviderChain, AI_PROVIDERS } from './providers/ai-provider-chain.service.js';
import { ConfigService } from '@nestjs/config';

const USER_ID = 'user-ai-test';

const makeSuggestion = (overrides = {}) => ({
  id: 'sug-1', userId: USER_ID,
  type: 'FINANCE', title: 'Test', message: 'Test msg',
  priority: 'MEDIUM', status: 'ACTIVE',
  sourceModule: 'finance', sourceEntityId: null,
  metadataJson: null, createdAt: new Date(), expiresAt: null,
  ...overrides,
});

const makeProfile = (overrides = {}) => ({
  id: 'profile-1', userId: USER_ID,
  financialHealthScore: 60, learningConsistencyScore: 55,
  nutritionScore: 0, productivityScore: 70, goalRiskScore: 50,
  profileJson: null, createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

describe('AIService', () => {
  let service: AIService;
  let prisma: jest.Mocked<PrismaService>;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    const mockPrisma = {
      aIProfile: { findUnique: jest.fn(), create: jest.fn(), upsert: jest.fn() },
      aISuggestion: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      recommendationLog: { create: jest.fn() },
      notification: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
      notificationPreference: { findUnique: jest.fn() },
      budget: { findMany: jest.fn() },
      expense: { findMany: jest.fn() },
      income: { findMany: jest.fn() },
      goal: { findMany: jest.fn() },
      goalForecast: { findMany: jest.fn() },
      userVocabularyProgress: { findMany: jest.fn(), count: jest.fn() },
      learningPlan: { findMany: jest.fn(), count: jest.fn() },
      reviewSession: { findMany: jest.fn(), count: jest.fn() },
      task: { findMany: jest.fn() },
    };

    const mockDeterministic = new DeterministicAIProvider();
    const mockChain = new AIProviderChain([mockDeterministic]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: { publish: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
        { provide: DeterministicAIProvider, useValue: mockDeterministic },
        { provide: GeminiAIProvider, useValue: { isAvailable: () => false, chat: jest.fn(), generateSummary: jest.fn(), generateText: jest.fn(), generateTextWithVision: jest.fn(), name: 'gemini', supportsVision: () => false } },
        { provide: AI_PROVIDERS, useValue: [mockDeterministic] },
        { provide: AIProviderChain, useValue: mockChain },
      ],
    }).compile();

    service = module.get(AIService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    eventsService = module.get(EventsService) as jest.Mocked<EventsService>;
  });

  // ─── AI Profile ──────────────────────────────────────────────────────────────

  it('returns existing profile', async () => {
    const profile = makeProfile();
    (prisma.aIProfile.findUnique as jest.Mock).mockResolvedValue(profile);
    const result = await service.getProfile(USER_ID);
    expect(result).toEqual(profile);
  });

  it('creates AI profile if not found', async () => {
    const profile = makeProfile();
    (prisma.aIProfile.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.aIProfile.create as jest.Mock).mockResolvedValue(profile);
    const result = await service.getOrCreateProfile(USER_ID);
    expect(prisma.aIProfile.create).toHaveBeenCalledWith({ data: { userId: USER_ID } });
    expect(result).toEqual(profile);
  });

  // ─── Recommendations ─────────────────────────────────────────────────────────

  it('generates deterministic recommendations (no budget)', async () => {
    (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goal.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goalForecast.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.userVocabularyProgress.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.learningPlan.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.aISuggestion.create as jest.Mock).mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'sug-new', ...args.data }));
    (prisma.recommendationLog.create as jest.Mock).mockResolvedValue({});
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.notification.create as jest.Mock).mockResolvedValue({});
    (prisma.aIProfile.upsert as jest.Mock).mockResolvedValue(makeProfile());
    (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.reviewSession.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.learningPlan.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.generateRecommendations(USER_ID);
    expect(result.generated).toBeGreaterThan(0);
    expect(eventsService.publish).toHaveBeenCalled();
  });

  it('generates budget exceeded suggestion when expenses > income', async () => {
    const income = [{ amount: { toString: () => '1000' } }];
    const expense = [{ amount: { toString: () => '2000' } }];
    (prisma.income.findMany as jest.Mock).mockResolvedValue(income);
    (prisma.expense.findMany as jest.Mock).mockResolvedValue(expense);
    (prisma.budget.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', totalLimit: { toString: () => '3000' } }]);
    (prisma.goal.findMany as jest.Mock).mockResolvedValue([{ id: 'g1', title: 'Test' }]);
    (prisma.goalForecast.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.userVocabularyProgress.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.learningPlan.findMany as jest.Mock).mockResolvedValue([{ id: 'lp1' }]);
    (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({ budgetWarning: true });
    (prisma.notification.create as jest.Mock).mockResolvedValue({});
    (prisma.aISuggestion.create as jest.Mock).mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'sug-x', ...args.data }));
    (prisma.recommendationLog.create as jest.Mock).mockResolvedValue({});
    (prisma.aIProfile.upsert as jest.Mock).mockResolvedValue(makeProfile());
    (prisma.reviewSession.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goal.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.generateRecommendations(USER_ID);
    const titles = (result.suggestions as { title?: string }[]).map((s) => s.title);
    const hasBudgetSuggestion = titles.some((t) => t?.includes('Chi tiêu vượt') || t?.includes('Chưa có ngân sách'));
    expect(hasBudgetSuggestion).toBe(true);
  });

  it('generates overdue task suggestion', async () => {
    (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goal.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goalForecast.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.userVocabularyProgress.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.learningPlan.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.task.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 't1', status: 'OVERDUE', title: 'Task 1', priority: 'HIGH', scheduledStart: null }])
      .mockResolvedValueOnce([]);
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({ taskReminder: true });
    (prisma.notification.create as jest.Mock).mockResolvedValue({});
    (prisma.aISuggestion.create as jest.Mock).mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'sug-x', ...args.data }));
    (prisma.recommendationLog.create as jest.Mock).mockResolvedValue({});
    (prisma.aIProfile.upsert as jest.Mock).mockResolvedValue(makeProfile());
    (prisma.reviewSession.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.generateRecommendations(USER_ID);
    const titles = (result.suggestions as { title?: string }[]).map((s) => s.title);
    expect(titles.some((t) => t?.includes('quá hạn'))).toBe(true);
  });

  it('generates learning review suggestion when many words due', async () => {
    (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goal.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goalForecast.findMany as jest.Mock).mockResolvedValue([]);
    const dueWords = Array.from({ length: 10 }, (_, i) => ({ id: `vp-${i}`, nextReviewAt: new Date(Date.now() - 1000) }));
    (prisma.userVocabularyProgress.findMany as jest.Mock).mockResolvedValue(dueWords);
    (prisma.learningPlan.findMany as jest.Mock).mockResolvedValue([{ id: 'lp1' }]);
    (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({ dailyVocabulary: true });
    (prisma.notification.create as jest.Mock).mockResolvedValue({});
    (prisma.aISuggestion.create as jest.Mock).mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'sug-x', ...args.data }));
    (prisma.recommendationLog.create as jest.Mock).mockResolvedValue({});
    (prisma.aIProfile.upsert as jest.Mock).mockResolvedValue(makeProfile());
    (prisma.reviewSession.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.generateRecommendations(USER_ID);
    const titles = (result.suggestions as { title?: string }[]).map((s) => s.title);
    expect(titles.some((t) => t?.includes('từ cần ôn'))).toBe(true);
  });

  // ─── Accept / Dismiss ─────────────────────────────────────────────────────────

  it('accepts suggestion', async () => {
    const sug = makeSuggestion();
    (prisma.aISuggestion.findFirst as jest.Mock).mockResolvedValue(sug);
    (prisma.aISuggestion.update as jest.Mock).mockResolvedValue({ ...sug, status: 'ACCEPTED' });
    const result = await service.acceptSuggestion(USER_ID, sug.id);
    expect(result.status).toBe('ACCEPTED');
    expect(eventsService.publish).toHaveBeenCalled();
  });

  it('dismisses suggestion', async () => {
    const sug = makeSuggestion();
    (prisma.aISuggestion.findFirst as jest.Mock).mockResolvedValue(sug);
    (prisma.aISuggestion.update as jest.Mock).mockResolvedValue({ ...sug, status: 'DISMISSED' });
    const result = await service.dismissSuggestion(USER_ID, sug.id);
    expect(result.status).toBe('DISMISSED');
  });

  it('throws NotFoundException when suggestion not found for accept', async () => {
    (prisma.aISuggestion.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.acceptSuggestion(USER_ID, 'missing-id')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when suggestion not found for dismiss', async () => {
    (prisma.aISuggestion.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.dismissSuggestion(USER_ID, 'missing-id')).rejects.toThrow(NotFoundException);
  });

  // ─── Chat ─────────────────────────────────────────────────────────────────────

  it('chat falls back to deterministic when gemini not available', async () => {
    (prisma.recommendationLog.create as jest.Mock).mockResolvedValue({});
    const result = await service.chat(USER_ID, [{ role: 'user', content: 'Tài chính của tôi thế nào?' }]);
    expect(result.provider).toBe('deterministic');
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  // ─── Recommendation log ───────────────────────────────────────────────────────

  it('creates recommendation log on generate', async () => {
    (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goal.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goalForecast.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.userVocabularyProgress.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.learningPlan.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.notification.create as jest.Mock).mockResolvedValue({});
    (prisma.aISuggestion.create as jest.Mock).mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'sug-x', ...args.data }));
    (prisma.recommendationLog.create as jest.Mock).mockResolvedValue({ id: 'log-1' });
    (prisma.aIProfile.upsert as jest.Mock).mockResolvedValue(makeProfile());
    (prisma.reviewSession.findMany as jest.Mock).mockResolvedValue([]);

    await service.generateRecommendations(USER_ID);
    expect(prisma.recommendationLog.create).toHaveBeenCalled();
  });

  // ─── Cashflow Forecast ────────────────────────────────────────────────────────

  describe('getCashflowForecast', () => {
    const now = new Date();
    // Months strictly before the current one, matching the service's [now-6, now) window.
    const monthDate = (offsetFromNow: number, day = 10) => new Date(now.getFullYear(), now.getMonth() + offsetFromNow, day);

    it('falls back to deterministic narrative/recommendations when no AI provider is available', async () => {
      const incomes = [-1, -2, -3, -4, -5, -6].map((o) => ({ amount: { toString: () => '30000' }, receivedDate: monthDate(o) }));
      const expenses = [-1, -2, -3, -4, -5, -6].flatMap((o) => [
        { amount: { toString: () => '10000' }, expenseDate: monthDate(o), category: { name: 'Ăn uống' } },
        { amount: { toString: () => '5000' }, expenseDate: monthDate(o), category: { name: 'Di chuyển' } },
      ]);
      (prisma.income.findMany as jest.Mock).mockResolvedValue(incomes);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue(expenses);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCashflowForecast(USER_ID);

      expect(result.provider).toBe('deterministic');
      expect(result.averageMonthlyIncome).toBe(30000);
      expect(result.averageMonthlyExpense).toBe(15000);
      expect(result.projectedMonthlySavings).toBe(15000);
      expect(result.riskLevel).toBe('LOW');
      expect(result.trend).toBe('STABLE');
      expect(result.biggestCategory).toEqual({ name: 'Ăn uống', amount: 60000, percent: 67 });
      expect(result.recommendations.some((r) => r.includes('Ăn uống'))).toBe(true);
      expect(result.narrative.length).toBeGreaterThan(0);
    });

    it('flags HIGH risk when average expenses exceed average income', async () => {
      const incomes = [-1, -2, -3, -4, -5, -6].map((o) => ({ amount: { toString: () => '10000' }, receivedDate: monthDate(o) }));
      const expenses = [-1, -2, -3, -4, -5, -6].map((o) => ({
        amount: { toString: () => '15000' },
        expenseDate: monthDate(o),
        category: null,
      }));
      (prisma.income.findMany as jest.Mock).mockResolvedValue(incomes);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue(expenses);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCashflowForecast(USER_ID);

      expect(result.riskLevel).toBe('HIGH');
      expect(result.projectedMonthlySavings).toBeLessThan(0);
      expect(result.recommendations.some((r) => r.includes('vượt thu nhập'))).toBe(true);
    });

    it('returns a no-data narrative and skips the AI call when there is no history', async () => {
      (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCashflowForecast(USER_ID);

      expect(result.provider).toBe('deterministic');
      expect(result.biggestCategory).toBeNull();
      expect(result.narrative).toContain('Chưa có đủ dữ liệu');
    });
  });
});
