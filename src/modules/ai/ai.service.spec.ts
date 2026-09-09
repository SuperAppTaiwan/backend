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
      task: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
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
    const income = [{ amount: { toString: () => '1000' }, currency: 'TWD' }];
    const expense = [{ amount: { toString: () => '2000' }, currency: 'TWD' }];
    (prisma.income.findMany as jest.Mock).mockResolvedValue(income);
    (prisma.expense.findMany as jest.Mock).mockResolvedValue(expense);
    (prisma.budget.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', currency: 'TWD', totalLimit: { toString: () => '3000' } }]);
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

  it('flags an over-budget currency without a healthy other currency masking it (or vice versa)', async () => {
    // TWD is in deficit; VND has a large surplus. A mixed-currency sum would net out to
    // "healthy" and hide the real TWD problem — the fix must flag TWD specifically.
    const income = [
      { amount: { toString: () => '1000' }, currency: 'TWD' },
      { amount: { toString: () => '90000000' }, currency: 'VND' },
    ];
    const expense = [
      { amount: { toString: () => '5000' }, currency: 'TWD' },
      { amount: { toString: () => '1000000' }, currency: 'VND' },
    ];
    (prisma.income.findMany as jest.Mock).mockResolvedValue(income);
    (prisma.expense.findMany as jest.Mock).mockResolvedValue(expense);
    (prisma.budget.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', currency: 'TWD', totalLimit: { toString: () => '3000' } }]);
    (prisma.goal.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goalForecast.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.userVocabularyProgress.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.learningPlan.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({ budgetWarning: true });
    (prisma.notification.create as jest.Mock).mockResolvedValue({});
    (prisma.aISuggestion.create as jest.Mock).mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'sug-x', ...args.data }));
    (prisma.recommendationLog.create as jest.Mock).mockResolvedValue({});
    (prisma.aIProfile.upsert as jest.Mock).mockResolvedValue(makeProfile());
    (prisma.reviewSession.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.generateRecommendations(USER_ID);
    const messages = (result.suggestions as { message?: string }[]).map((s) => s.message ?? '');
    expect(messages.some((m) => m.includes('TWD'))).toBe(true);
    expect(messages.some((m) => m.includes('4000 TWD') || m.includes('4.000 TWD'))).toBe(true);
    // The VND surplus must never appear in a "vượt thu nhập" (over-income) message.
    expect(messages.some((m) => m.includes('vượt thu nhập') && m.includes('VND'))).toBe(false);
  });

  it('computes financialHealthScore from per-currency savings ratios, never a mixed-currency sum', async () => {
    // VND: huge surplus (would push score near 100 if summed in). TWD: deficit (would drag
    // score down). If these were summed as raw amounts first, the VND volume would swamp the
    // TWD deficit; averaging per-currency scores keeps both currencies' health independently
    // visible instead.
    const income = [
      { amount: { toString: () => '100000000' }, currency: 'VND' },
      { amount: { toString: () => '1000' }, currency: 'TWD' },
    ];
    const expense = [
      { amount: { toString: () => '1000000' }, currency: 'VND' },
      { amount: { toString: () => '5000' }, currency: 'TWD' },
    ];
    (prisma.income.findMany as jest.Mock).mockResolvedValue(income);
    (prisma.expense.findMany as jest.Mock).mockResolvedValue(expense);
    (prisma.budget.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', currency: 'TWD', totalLimit: { toString: () => '3000' } }]);
    (prisma.goal.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.goalForecast.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.userVocabularyProgress.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.learningPlan.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({});
    (prisma.notification.create as jest.Mock).mockResolvedValue({});
    (prisma.aISuggestion.create as jest.Mock).mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'sug-x', ...args.data }));
    (prisma.recommendationLog.create as jest.Mock).mockResolvedValue({});
    let upsertArgs: { create: Record<string, unknown> } | null = null;
    (prisma.aIProfile.upsert as jest.Mock).mockImplementation((args) => {
      upsertArgs = args;
      return Promise.resolve(makeProfile());
    });
    (prisma.reviewSession.findMany as jest.Mock).mockResolvedValue([]);

    await service.generateRecommendations(USER_ID);

    expect(upsertArgs).not.toBeNull();
    const score = (upsertArgs!.create as { financialHealthScore: number }).financialHealthScore;
    // VND ratio: (100M-1M)/100M ~ 0.99 -> score ~99.5. TWD ratio: (1000-5000)/1000 = -4 -> score
    // clamped to 0. Average of ~99.5 and 0 is ~50 — nowhere near what a naive mixed-currency sum
    // would produce (VND volume would completely dominate and hide the TWD deficit).
    expect(score).toBeGreaterThan(30);
    expect(score).toBeLessThan(70);
    const profileJson = (upsertArgs!.create as { profileJson: { incomeByCurrency: Record<string, number> } }).profileJson;
    expect(profileJson.incomeByCurrency.VND).toBe(100000000);
    expect(profileJson.incomeByCurrency.TWD).toBe(1000);
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

  describe('getDailySummary', () => {
    it('feeds real finance/schedule data into the summary context instead of hardcoded zeros', async () => {
      (prisma.aISuggestion.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.aIProfile.findUnique as jest.Mock).mockResolvedValue(makeProfile());
      (prisma.userVocabularyProgress.count as jest.Mock).mockResolvedValue(4);
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.income.findMany as jest.Mock).mockResolvedValue([{ amount: { toString: () => '25000' }, currency: 'TWD' }]);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([{ amount: { toString: () => '9000' }, currency: 'TWD' }]);
      (prisma.task.count as jest.Mock)
        .mockResolvedValueOnce(2) // overdue
        .mockResolvedValueOnce(5); // completed this week

      const result = await service.getDailySummary(USER_ID);

      // Real net savings (25000-9000=16000) surfaces via the deterministic provider's
      // finance line, not the old hardcoded netSavings:0.
      expect(result.summary).toContain('16.000');
      expect(result.summary).toContain('TWD');
      expect(result.provider).toBeDefined();
    });

    it('keeps VND and TWD net savings separate in the summary, never combined', async () => {
      (prisma.aISuggestion.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.aIProfile.findUnique as jest.Mock).mockResolvedValue(makeProfile());
      (prisma.userVocabularyProgress.count as jest.Mock).mockResolvedValue(0);
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.income.findMany as jest.Mock).mockResolvedValue([
        { amount: { toString: () => '60000000' }, currency: 'VND' },
        { amount: { toString: () => '10000' }, currency: 'TWD' },
      ]);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([
        { amount: { toString: () => '5000000' }, currency: 'VND' },
        { amount: { toString: () => '2000' }, currency: 'TWD' },
      ]);
      (prisma.task.count as jest.Mock).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await service.getDailySummary(USER_ID);

      expect(result.summary).toContain('55.000.000 VND');
      expect(result.summary).toContain('8.000 TWD');
      // Never a cross-currency blend like 60,010,000 or 55,008,000.
      expect(result.summary).not.toContain('60.010.000');
      expect(result.summary).not.toContain('55.008.000');
    });
  });

  describe('getWeeklyReport', () => {
    it('groups the week\'s expenses by currency instead of one mixed total', async () => {
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.reviewSession.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.aISuggestion.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([
        { amount: { toString: () => '60000000' }, currency: 'VND' },
        { amount: { toString: () => '10000' }, currency: 'TWD' },
      ]);

      const result = await service.getWeeklyReport(USER_ID);

      expect(result.finance.expenseByCurrency.VND).toBe(60000000);
      expect(result.finance.expenseByCurrency.TWD).toBe(10000);
    });
  });

  describe('analyzeBudget', () => {
    it('scopes totalExpense to the budget\'s own currency, ignoring other currencies entirely', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([
        { amount: { toString: () => '6000' }, currency: 'TWD' },
        { amount: { toString: () => '50000000' }, currency: 'VND' },
      ]);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([
        { id: 'b1', currency: 'TWD', totalLimit: { toString: () => '20000' } },
      ]);

      const result = await service.analyzeBudget(USER_ID);

      expect(result.totalExpense).toBe(6000);
      expect(result.usedPercent).toBe(30);
    });

    it('returns a zero (not mixed-currency) total when no budget exists', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([
        { amount: { toString: () => '6000' }, currency: 'TWD' },
        { amount: { toString: () => '50000000' }, currency: 'VND' },
      ]);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.analyzeBudget(USER_ID);

      expect(result.totalExpense).toBe(0);
    });
  });

  describe('getCashflowForecast', () => {
    const now = new Date();
    // Months strictly before the current one, matching the service's [now-6, now) window.
    const monthDate = (offsetFromNow: number, day = 10) => new Date(now.getFullYear(), now.getMonth() + offsetFromNow, day);

    it('falls back to deterministic narrative/recommendations when no AI provider is available', async () => {
      const incomes = [-1, -2, -3, -4, -5, -6].map((o) => ({ amount: { toString: () => '30000' }, currency: 'TWD', receivedDate: monthDate(o) }));
      const expenses = [-1, -2, -3, -4, -5, -6].flatMap((o) => [
        { amount: { toString: () => '10000' }, currency: 'TWD', expenseDate: monthDate(o), category: { name: 'Ăn uống' } },
        { amount: { toString: () => '5000' }, currency: 'TWD', expenseDate: monthDate(o), category: { name: 'Di chuyển' } },
      ]);
      (prisma.income.findMany as jest.Mock).mockResolvedValue(incomes);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue(expenses);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCashflowForecast(USER_ID);
      const twd = result.currencies['TWD'];

      expect(twd.provider).toBe('deterministic');
      expect(twd.averageMonthlyIncome).toBe(30000);
      expect(twd.averageMonthlyExpense).toBe(15000);
      expect(twd.projectedMonthlySavings).toBe(15000);
      expect(twd.riskLevel).toBe('LOW');
      expect(twd.trend).toBe('STABLE');
      expect(twd.biggestCategory).toEqual({ name: 'Ăn uống', amount: 60000, percent: 67 });
      expect(twd.recommendations.some((r: string) => r.includes('Ăn uống'))).toBe(true);
      expect(twd.narrative.length).toBeGreaterThan(0);
    });

    it('flags HIGH risk when average expenses exceed average income', async () => {
      const incomes = [-1, -2, -3, -4, -5, -6].map((o) => ({ amount: { toString: () => '10000' }, currency: 'TWD', receivedDate: monthDate(o) }));
      const expenses = [-1, -2, -3, -4, -5, -6].map((o) => ({
        amount: { toString: () => '15000' },
        currency: 'TWD',
        expenseDate: monthDate(o),
        category: null,
      }));
      (prisma.income.findMany as jest.Mock).mockResolvedValue(incomes);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue(expenses);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCashflowForecast(USER_ID);
      const twd = result.currencies['TWD'];

      expect(twd.riskLevel).toBe('HIGH');
      expect(twd.projectedMonthlySavings).toBeLessThan(0);
      expect(twd.recommendations.some((r: string) => r.includes('vượt thu nhập'))).toBe(true);
    });

    it('returns a no-data narrative and skips the AI call when there is no history', async () => {
      (prisma.income.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCashflowForecast(USER_ID);
      const vnd = result.currencies['VND'];

      expect(vnd.provider).toBe('deterministic');
      expect(vnd.biggestCategory).toBeNull();
      expect(vnd.narrative).toContain('Chưa có dữ liệu');
    });

    it('produces a forecast with LIMITED confidence from a single month of data instead of blocking', async () => {
      const incomes = [{ amount: { toString: () => '20000' }, currency: 'TWD', receivedDate: monthDate(-1) }];
      const expenses = [{ amount: { toString: () => '8000' }, currency: 'TWD', expenseDate: monthDate(-1), category: { name: 'Ăn uống' } }];
      (prisma.income.findMany as jest.Mock).mockResolvedValue(incomes);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue(expenses);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCashflowForecast(USER_ID);
      const twd = result.currencies['TWD'];

      expect(twd.basedOnMonths).toBe(1);
      expect(twd.confidence).toBe('LIMITED');
      // Averaged over the real 1-month span, not diluted by 5 empty months in a fixed 6-month divisor.
      expect(twd.averageMonthlyIncome).toBe(20000);
      expect(twd.averageMonthlyExpense).toBe(8000);
      expect(twd.trend).toBe('NOT_ENOUGH_DATA');
      expect(twd.narrative.length).toBeGreaterThan(0);
    });

    it('reports MODERATE confidence with 2-3 months of data', async () => {
      const incomes = [-1, -2].map((o) => ({ amount: { toString: () => '20000' }, currency: 'TWD', receivedDate: monthDate(o) }));
      const expenses = [-1, -2].map((o) => ({ amount: { toString: () => '8000' }, currency: 'TWD', expenseDate: monthDate(o), category: { name: 'Ăn uống' } }));
      (prisma.income.findMany as jest.Mock).mockResolvedValue(incomes);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue(expenses);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCashflowForecast(USER_ID);
      const twd = result.currencies['TWD'];

      expect(twd.basedOnMonths).toBe(2);
      expect(twd.confidence).toBe('MODERATE');
      expect(twd.averageMonthlyIncome).toBe(20000);
    });

    it('keeps VND and TWD forecasts fully independent when both are present', async () => {
      const incomes = [-1, -2, -3, -4].flatMap((o) => [
        { amount: { toString: () => '30000000' }, currency: 'VND', receivedDate: monthDate(o) },
        { amount: { toString: () => '20000' }, currency: 'TWD', receivedDate: monthDate(o) },
      ]);
      const expenses = [-1, -2, -3, -4].flatMap((o) => [
        { amount: { toString: () => '10000000' }, currency: 'VND', expenseDate: monthDate(o), category: null },
        { amount: { toString: () => '5000' }, currency: 'TWD', expenseDate: monthDate(o), category: null },
      ]);
      (prisma.income.findMany as jest.Mock).mockResolvedValue(incomes);
      (prisma.expense.findMany as jest.Mock).mockResolvedValue(expenses);
      (prisma.budget.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getCashflowForecast(USER_ID);

      expect(Object.keys(result.currencies).sort()).toEqual(['TWD', 'VND']);
      expect(result.currencies['VND'].averageMonthlyIncome).toBe(30000000);
      expect(result.currencies['TWD'].averageMonthlyIncome).toBe(20000);
      // Never a cross-currency blend like 30000000 + 20000.
      expect(result.currencies['VND'].averageMonthlyIncome).not.toBe(30020000);
    });
  });
});
