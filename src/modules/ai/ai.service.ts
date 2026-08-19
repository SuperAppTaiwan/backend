import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AISuggestionStatus, AISuggestionType, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { DeterministicAIProvider } from './providers/deterministic-ai.provider.js';
import { AIProviderChain } from './providers/ai-provider-chain.service.js';
import type { AIChatMessage } from './providers/ai-provider.interface.js';

interface SuggestionInput {
  type: AISuggestionType;
  title: string;
  message: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  sourceModule: string;
  sourceEntityId?: string;
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly deterministicProvider: DeterministicAIProvider,
    private readonly chain: AIProviderChain,
  ) {}

  // ─── AI Profile ──────────────────────────────────────────────────────────────

  async getOrCreateProfile(userId: string) {
    let profile = await this.prisma.aIProfile.findUnique({ where: { userId } });
    if (!profile) {
      profile = await this.prisma.aIProfile.create({
        data: { userId },
      });
    }
    return profile;
  }

  async getProfile(userId: string) {
    return this.getOrCreateProfile(userId);
  }

  private async computeAndSaveProfile(userId: string): Promise<void> {
    const [budgets, expenses, incomes, tasks, reviewSessions, learningPlans, goals] =
      await Promise.allSettled([
        this.prisma.budget.findMany({ where: { userId } }),
        this.prisma.expense.findMany({ where: { userId }, take: 100, orderBy: { createdAt: 'desc' } }),
        this.prisma.income.findMany({ where: { userId }, take: 100, orderBy: { createdAt: 'desc' } }),
        this.prisma.task.findMany({ where: { userId } }),
        this.prisma.reviewSession.findMany({ where: { userId }, take: 50, orderBy: { createdAt: 'desc' } }),
        this.prisma.learningPlan.findMany({ where: { userId, status: 'ACTIVE' } }),
        this.prisma.goal.findMany({ where: { userId, status: 'ACTIVE' } }),
      ]);

    const budgetList = budgets.status === 'fulfilled' ? budgets.value : [];
    const expenseList = expenses.status === 'fulfilled' ? expenses.value : [];
    const incomeList = incomes.status === 'fulfilled' ? incomes.value : [];
    const taskList = tasks.status === 'fulfilled' ? tasks.value : [];
    const sessionList = reviewSessions.status === 'fulfilled' ? reviewSessions.value : [];
    const planList = learningPlans.status === 'fulfilled' ? learningPlans.value : [];
    const goalList = goals.status === 'fulfilled' ? goals.value : [];

    const totalIncome = incomeList.reduce((s, i) => s + parseFloat(i.amount.toString()), 0);
    const totalExpense = expenseList.reduce((s, e) => s + parseFloat(e.amount.toString()), 0);
    const hasBudget = budgetList.length > 0;
    const savings = totalIncome - totalExpense;
    const financialHealthScore = hasBudget
      ? Math.min(100, Math.max(0, Math.round(50 + (savings / Math.max(totalIncome, 1)) * 50)))
      : 30;

    const completedTasks = taskList.filter((t) => t.status === 'COMPLETED').length;
    const totalTasks = taskList.length;
    const productivityScore = totalTasks > 0
      ? Math.min(100, Math.round((completedTasks / totalTasks) * 100))
      : 50;

    const recentSessions = sessionList.slice(0, 20);
    const goodReviews = recentSessions.filter((s) => s.result === 'GOOD' || s.result === 'EASY').length;
    const learningConsistencyScore = planList.length > 0
      ? Math.min(100, Math.max(0, Math.round(40 + (recentSessions.length / 20) * 30 + (goodReviews / Math.max(recentSessions.length, 1)) * 30)))
      : recentSessions.length > 0 ? 40 : 10;

    const goalRiskScore = goalList.length > 0 ? 50 : 20;

    const profileJson: Prisma.InputJsonValue = {
      computedAt: new Date().toISOString(),
      totalIncome,
      totalExpense,
      savings,
      hasBudget,
      activePlans: planList.length,
      activeGoals: goalList.length,
      totalTasks,
      completedTasks,
    };

    await this.prisma.aIProfile.upsert({
      where: { userId },
      create: { userId, financialHealthScore, learningConsistencyScore, productivityScore, goalRiskScore, profileJson },
      update: { financialHealthScore, learningConsistencyScore, productivityScore, goalRiskScore, profileJson, updatedAt: new Date() },
    });
  }

  // ─── Recommendations ─────────────────────────────────────────────────────────

  async generateRecommendations(userId: string): Promise<{ generated: number; suggestions: unknown[] }> {
    const suggestions: SuggestionInput[] = [];

    // --- Finance analysis ---
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);

      const [incomes, expenses, budgets] = await Promise.all([
        this.prisma.income.findMany({ where: { userId, receivedDate: { gte: start, lt: end } } }),
        this.prisma.expense.findMany({ where: { userId, expenseDate: { gte: start, lt: end } } }),
        this.prisma.budget.findMany({ where: { userId } }),
      ]);

      const totalIncome = incomes.reduce((s, i) => s + parseFloat(i.amount.toString()), 0);
      const totalExpense = expenses.reduce((s, e) => s + parseFloat(e.amount.toString()), 0);
      const netSavings = totalIncome - totalExpense;

      if (budgets.length === 0) {
        suggestions.push({ type: 'FINANCE', title: 'Chưa có ngân sách', message: 'Tạo ngân sách tháng giúp bạn kiểm soát chi tiêu hiệu quả hơn.', priority: 'MEDIUM', sourceModule: 'finance' });
      }

      if (netSavings < 0) {
        suggestions.push({ type: 'FINANCE', title: 'Chi tiêu vượt thu nhập', message: `Chi tiêu tháng này vượt thu nhập ${Math.abs(netSavings).toFixed(0)} TWD. Hãy rà soát các khoản chi không cần thiết.`, priority: 'HIGH', sourceModule: 'finance' });
      } else if (totalIncome > 0 && netSavings / totalIncome < 0.1) {
        suggestions.push({ type: 'FINANCE', title: 'Tỷ lệ tiết kiệm thấp', message: 'Tỷ lệ tiết kiệm dưới 10%. Mục tiêu lý tưởng là 20-30% thu nhập.', priority: 'MEDIUM', sourceModule: 'finance' });
      }
    } catch (err) {
      this.logger.warn('Finance analysis failed', err);
    }

    // --- Goals analysis ---
    try {
      const goals = await this.prisma.goal.findMany({ where: { userId, status: 'ACTIVE' } });
      if (goals.length === 0) {
        suggestions.push({ type: 'GOAL', title: 'Chưa có mục tiêu', message: 'Đặt mục tiêu tài chính hoặc học tập đầu tiên để định hướng hành động hàng ngày.', priority: 'MEDIUM', sourceModule: 'goals' });
      } else {
        const forecasts = await this.prisma.goalForecast.findMany({
          where: { userId, goalId: { in: goals.map((g) => g.id) } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
        const highRisk = forecasts.filter((f) => f.riskLevel === 'HIGH');
        if (highRisk.length > 0) {
          suggestions.push({ type: 'GOAL', title: 'Mục tiêu có rủi ro cao', message: `${highRisk.length} mục tiêu đang ở mức rủi ro cao. Hãy điều chỉnh tiết kiệm hàng tháng hoặc dời ngày hoàn thành.`, priority: 'HIGH', sourceModule: 'goals' });
        }
      }
    } catch (err) {
      this.logger.warn('Goals analysis failed', err);
    }

    // --- Learning analysis ---
    try {
      const [progress, activePlans] = await Promise.all([
        this.prisma.userVocabularyProgress.findMany({ where: { userId, nextReviewAt: { lte: new Date() } } }),
        this.prisma.learningPlan.findMany({ where: { userId, status: 'ACTIVE' } }),
      ]);

      if (activePlans.length === 0) {
        suggestions.push({ type: 'LEARNING', title: 'Chưa có kế hoạch học', message: 'Tạo kế hoạch học tiếng Trung để theo dõi tiến độ và học đều đặn hơn.', priority: 'MEDIUM', sourceModule: 'learning' });
      }

      if (progress.length >= 5) {
        suggestions.push({ type: 'LEARNING', title: `Còn ${progress.length} từ cần ôn`, message: `Bạn có ${progress.length} từ cần ôn lại hôm nay. Dành 10-15 phút ôn tập ngay bây giờ.`, priority: progress.length >= 15 ? 'HIGH' : 'MEDIUM', sourceModule: 'learning' });
      }
    } catch (err) {
      this.logger.warn('Learning analysis failed', err);
    }

    // --- Schedule analysis ---
    try {
      const [overdueTasks, unscheduledTasks] = await Promise.all([
        this.prisma.task.findMany({ where: { userId, status: 'OVERDUE' } }),
        this.prisma.task.findMany({ where: { userId, status: { in: ['TODO', 'IN_PROGRESS'] }, scheduledStart: null } }),
      ]);

      if (overdueTasks.length > 0) {
        suggestions.push({ type: 'SCHEDULE', title: `${overdueTasks.length} việc quá hạn`, message: `Bạn có ${overdueTasks.length} việc đã quá hạn. Hãy xử lý hoặc lên lịch lại ngay.`, priority: 'URGENT', sourceModule: 'schedule' });
      }

      if (unscheduledTasks.length >= 5) {
        suggestions.push({ type: 'SCHEDULE', title: 'Nhiều việc chưa lên lịch', message: `${unscheduledTasks.length} công việc chưa được lên lịch. Sử dụng tính năng tự động lên lịch để tổ chức ngày làm việc.`, priority: 'MEDIUM', sourceModule: 'schedule' });
      }
    } catch (err) {
      this.logger.warn('Schedule analysis failed', err);
    }

    // --- Lifestyle suggestion ---
    suggestions.push({
      type: 'LIFESTYLE',
      title: 'Lời khuyên hôm nay',
      message: 'Dành 5 phút cuối ngày để viết 3 việc bạn đã hoàn thành. Điều này giúp tăng động lực và nhìn nhận tiến độ rõ ràng hơn.',
      priority: 'LOW',
      sourceModule: 'system',
    });

    // Save suggestions
    const created: unknown[] = [];
    for (const s of suggestions) {
      const saved = await this.prisma.aISuggestion.create({
        data: {
          userId,
          type: s.type as AISuggestionType,
          title: s.title,
          message: s.message,
          priority: s.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT',
          sourceModule: s.sourceModule,
          sourceEntityId: s.sourceEntityId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      created.push(saved);
    }

    // Create notifications for urgent suggestions
    try {
      const urgentSuggestions = suggestions.filter((s) => s.priority === 'URGENT' || s.priority === 'HIGH');
      const prefs = await this.prisma.notificationPreference.findUnique({ where: { userId } });
      for (const s of urgentSuggestions.slice(0, 3)) {
        const type = s.type === 'FINANCE' ? NotificationType.BUDGET_WARNING
          : s.type === 'SCHEDULE' ? NotificationType.TASK_REMINDER
          : s.type === 'LEARNING' ? NotificationType.DAILY_VOCABULARY
          : NotificationType.SYSTEM;

        const shouldCreate = type === NotificationType.BUDGET_WARNING ? (prefs?.budgetWarning ?? true)
          : type === NotificationType.TASK_REMINDER ? (prefs?.taskReminder ?? true)
          : type === NotificationType.DAILY_VOCABULARY ? (prefs?.dailyVocabulary ?? true)
          : true;

        if (shouldCreate) {
          await this.prisma.notification.create({
            data: { userId, type, title: s.title, message: s.message },
          });
        }
      }
    } catch (err) {
      this.logger.warn('Notification creation from suggestions failed', err);
    }

    // Log recommendation
    await this.prisma.recommendationLog.create({
      data: {
        userId,
        requestType: 'generate_recommendations',
        outputJson: { count: created.length } as Prisma.InputJsonValue,
        provider: 'deterministic',
      },
    });

    // Compute and save profile scores
    await this.computeAndSaveProfile(userId).catch((e) => this.logger.warn('Profile score update failed', e));

    await this.events.publish({
      userId,
      eventType: EventType.AI_RECOMMENDATIONS_GENERATED,
      sourceModule: 'ai',
      payload: { count: created.length },
    });

    return { generated: created.length, suggestions: created };
  }

  async getSuggestions(userId: string, status?: AISuggestionStatus) {
    return this.prisma.aISuggestion.findMany({
      where: { userId, ...(status ? { status } : {}) },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async acceptSuggestion(userId: string, id: string) {
    const suggestion = await this.prisma.aISuggestion.findFirst({ where: { id, userId } });
    if (!suggestion) throw new NotFoundException('Suggestion not found');
    const updated = await this.prisma.aISuggestion.update({
      where: { id },
      data: { status: AISuggestionStatus.ACCEPTED },
    });
    await this.events.publish({ userId, eventType: EventType.AI_SUGGESTION_ACCEPTED, sourceModule: 'ai', payload: { id } });
    return updated;
  }

  async dismissSuggestion(userId: string, id: string) {
    const suggestion = await this.prisma.aISuggestion.findFirst({ where: { id, userId } });
    if (!suggestion) throw new NotFoundException('Suggestion not found');
    const updated = await this.prisma.aISuggestion.update({
      where: { id },
      data: { status: AISuggestionStatus.DISMISSED },
    });
    await this.events.publish({ userId, eventType: EventType.AI_SUGGESTION_DISMISSED, sourceModule: 'ai', payload: { id } });
    return updated;
  }

  // ─── Daily Summary ────────────────────────────────────────────────────────────

  async getDailySummary(userId: string) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [suggestions, profile, learningProgress, tasks, monthIncomes, monthExpenses, overdueTaskCount, completedThisWeekCount] =
      await Promise.allSettled([
        this.prisma.aISuggestion.findMany({ where: { userId, status: 'ACTIVE' }, take: 5, orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }] }),
        this.getOrCreateProfile(userId),
        this.prisma.userVocabularyProgress.count({ where: { userId, nextReviewAt: { lte: new Date() } } }),
        this.prisma.task.findMany({ where: { userId, status: { in: ['TODO', 'OVERDUE'] } }, take: 5, orderBy: { priority: 'asc' } }),
        this.prisma.income.findMany({ where: { userId, receivedDate: { gte: monthStart } } }),
        this.prisma.expense.findMany({ where: { userId, expenseDate: { gte: monthStart } } }),
        this.prisma.task.count({ where: { userId, status: 'OVERDUE' } }),
        this.prisma.task.count({ where: { userId, status: 'COMPLETED', updatedAt: { gte: weekAgo } } }),
      ]);

    const toAmount = (v: { toString(): string }) => parseFloat(v.toString());
    const netSavings =
      monthIncomes.status === 'fulfilled' && monthExpenses.status === 'fulfilled'
        ? monthIncomes.value.reduce((s, i) => s + toAmount(i.amount), 0) -
          monthExpenses.value.reduce((s, e) => s + toAmount(e.amount), 0)
        : 0;

    const context = {
      finance: { netSavings: Math.round(netSavings) },
      learning: { reviewDueCount: learningProgress.status === 'fulfilled' ? learningProgress.value : 0 },
      schedule: {
        overdueTasks: overdueTaskCount.status === 'fulfilled' ? overdueTaskCount.value : 0,
        completedThisWeek: completedThisWeekCount.status === 'fulfilled' ? completedThisWeekCount.value : 0,
      },
    };

    let summary: string;
    let providerName: string;
    try {
      const result = await this.chain.generateSummary({ userId, context });
      summary = result.summary;
      providerName = result.provider;
    } catch {
      const fallback = await this.deterministicProvider.generateSummary({ userId, context });
      summary = fallback.summary;
      providerName = 'deterministic';
    }

    return {
      summary,
      provider: providerName,
      activeSuggestions: suggestions.status === 'fulfilled' ? suggestions.value.length : 0,
      topSuggestions: suggestions.status === 'fulfilled' ? suggestions.value.slice(0, 3) : [],
      profile: profile.status === 'fulfilled' ? profile.value : null,
      pendingTasks: tasks.status === 'fulfilled' ? tasks.value : [],
    };
  }

  // ─── Weekly Report ────────────────────────────────────────────────────────────

  async getWeeklyReport(userId: string) {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const [tasks, reviews, suggestions, expenses] = await Promise.allSettled([
      this.prisma.task.findMany({ where: { userId, updatedAt: { gte: weekStart } } }),
      this.prisma.reviewSession.findMany({ where: { userId, reviewedAt: { gte: weekStart } } }),
      this.prisma.aISuggestion.findMany({ where: { userId, createdAt: { gte: weekStart } } }),
      this.prisma.expense.findMany({ where: { userId, expenseDate: { gte: weekStart } } }),
    ]);

    const taskList = tasks.status === 'fulfilled' ? tasks.value : [];
    const reviewList = reviews.status === 'fulfilled' ? reviews.value : [];
    const suggestionList = suggestions.status === 'fulfilled' ? suggestions.value : [];
    const expenseList = expenses.status === 'fulfilled' ? expenses.value : [];

    const completedTasks = taskList.filter((t) => t.status === 'COMPLETED').length;
    const totalExpense = expenseList.reduce((s, e) => s + parseFloat(e.amount.toString()), 0);

    return {
      period: { from: weekStart.toISOString(), to: new Date().toISOString() },
      tasks: { total: taskList.length, completed: completedTasks, completionRate: taskList.length > 0 ? Math.round((completedTasks / taskList.length) * 100) : 0 },
      learning: { reviewSessions: reviewList.length, correctRate: reviewList.length > 0 ? Math.round(reviewList.filter((r) => r.result === 'GOOD' || r.result === 'EASY').length / reviewList.length * 100) : 0 },
      finance: { totalExpense },
      suggestions: { generated: suggestionList.length, accepted: suggestionList.filter((s) => s.status === 'ACCEPTED').length, dismissed: suggestionList.filter((s) => s.status === 'DISMISSED').length },
    };
  }

  // ─── Conversations (persistent chat history) ──────────────────────────────────

  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      include: { _count: { select: { messages: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async createConversation(userId: string, title?: string) {
    const conversation = await this.prisma.conversation.create({
      data: { userId, title: title ?? 'Cuộc trò chuyện mới' },
    });
    await this.events.publish({
      userId,
      eventType: EventType.CONVERSATION_CREATED,
      sourceModule: 'ai',
      payload: { conversationId: conversation.id },
    });
    return conversation;
  }

  async getConversationMessages(userId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, userId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    return this.prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendConversationMessage(userId: string, conversationId: string, userContent: string) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, userId } });
    if (!conv) throw new NotFoundException('Conversation not found');

    // Persist user message
    await this.prisma.conversationMessage.create({
      data: { conversationId, role: 'user', content: userContent },
    });

    // Load conversation history for context
    const history = await this.prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const messages: AIChatMessage[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Get AI response
    let result: { message: string; provider: string };
    try {
      result = await this.chain.chat(messages);
    } catch {
      result = await this.deterministicProvider.chat(messages);
    }

    // Persist assistant response
    const assistantMsg = await this.prisma.conversationMessage.create({
      data: { conversationId, role: 'assistant', content: result.message, provider: result.provider },
    });

    // Update conversation timestamp
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    await this.events.publish({
      userId,
      eventType: EventType.CONVERSATION_MESSAGE_SENT,
      sourceModule: 'ai',
      payload: { conversationId, provider: result.provider },
    });

    return { userMessage: userContent, assistantMessage: assistantMsg.content, provider: result.provider };
  }

  async deleteConversation(userId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, userId } });
    if (!conv) throw new NotFoundException('Conversation not found');
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    await this.events.publish({
      userId,
      eventType: EventType.CONVERSATION_DELETED,
      sourceModule: 'ai',
      payload: { conversationId },
    });
    return { message: 'Conversation deleted' };
  }

  // ─── Chat (stateless) ─────────────────────────────────────────────────────────

  async chat(userId: string, messages: AIChatMessage[]) {
    let result: { message: string; provider: string };
    try {
      result = await this.chain.chat(messages);
    } catch {
      result = await this.deterministicProvider.chat(messages);
    }

    await this.prisma.recommendationLog.create({
      data: {
        userId,
        requestType: 'chat',
        inputJson: { messages: messages.length } as Prisma.InputJsonValue,
        outputJson: { provider: result.provider } as Prisma.InputJsonValue,
        provider: result.provider,
      },
    });

    return result;
  }

  // ─── Analysis endpoints ───────────────────────────────────────────────────────

  async analyzeGoals(userId: string) {
    const goals = await this.prisma.goal.findMany({ where: { userId, status: 'ACTIVE' }, take: 10 });
    const forecasts = await this.prisma.goalForecast.findMany({ where: { userId, goalId: { in: goals.map((g) => g.id) } }, take: 10 });

    const suggestions: string[] = [];
    if (goals.length === 0) suggestions.push('Bắt đầu đặt mục tiêu đầu tiên của bạn!');
    forecasts.filter((f) => f.riskLevel === 'HIGH').forEach((f) => {
      const goal = goals.find((g) => g.id === f.goalId);
      if (goal) suggestions.push(`Mục tiêu "${goal.title}" có rủi ro cao — tăng tiết kiệm hoặc điều chỉnh ngày mục tiêu.`);
    });

    return { goals: goals.length, forecasts: forecasts.length, suggestions, provider: 'deterministic' };
  }

  async analyzeBudget(userId: string) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [expenses, budgets] = await Promise.all([
      this.prisma.expense.findMany({ where: { userId, expenseDate: { gte: start, lt: end } } }),
      this.prisma.budget.findMany({ where: { userId } }),
    ]);

    const totalExpense = expenses.reduce((s, e) => s + parseFloat(e.amount.toString()), 0);
    const budgetAmount = budgets[0]?.totalLimit ? parseFloat(budgets[0].totalLimit.toString()) : 0;
    const suggestions: string[] = [];

    if (budgets.length === 0) suggestions.push('Tạo ngân sách tháng để kiểm soát chi tiêu tốt hơn.');
    else if (budgetAmount > 0 && totalExpense / budgetAmount > 0.8) suggestions.push(`Đã dùng ${Math.round(totalExpense / budgetAmount * 100)}% ngân sách — cẩn thận chi tiêu những ngày còn lại.`);

    return { totalExpense, budgetAmount, usedPercent: budgetAmount > 0 ? Math.round(totalExpense / budgetAmount * 100) : 0, suggestions, provider: 'deterministic' };
  }

  // ─── Cashflow Forecast (AI-backed, deterministic fallback) ───────────────────

  async getCashflowForecast(userId: string) {
    const MONTHS = 6;
    const now = new Date();
    const windowStart = new Date(now.getFullYear(), now.getMonth() - MONTHS, 1);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [incomes, expenses, budgets] = await Promise.all([
      this.prisma.income.findMany({ where: { userId, receivedDate: { gte: windowStart, lt: thisMonthStart } } }),
      this.prisma.expense.findMany({
        where: { userId, expenseDate: { gte: windowStart, lt: thisMonthStart } },
        include: { category: true },
      }),
      this.prisma.budget.findMany({ where: { userId }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 1 }),
    ]);

    const toAmount = (v: { toString(): string }) => parseFloat(v.toString());
    const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

    // Oldest-to-newest per-month buckets over the window, used for trend detection —
    // a single 6-month average can't tell "improving" from "declining", a month-by-month
    // series can.
    const monthBuckets = new Map<string, { income: number; expense: number }>();
    for (let i = MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
      monthBuckets.set(monthKey(d), { income: 0, expense: 0 });
    }
    for (const inc of incomes) {
      const bucket = monthBuckets.get(monthKey(inc.receivedDate));
      if (bucket) bucket.income += toAmount(inc.amount);
    }
    for (const exp of expenses) {
      const bucket = monthBuckets.get(monthKey(exp.expenseDate));
      if (bucket) bucket.expense += toAmount(exp.amount);
    }

    const monthlySeries = [...monthBuckets.values()];
    const hasAnyData = monthlySeries.some((m) => m.income > 0 || m.expense > 0);

    // How many calendar months of history the user actually has, not the fixed 6-month
    // window size — averaging fixed totals over MONTHS=6 silently divides by empty
    // months for anyone newer than that, crushing the projection toward zero. Instead,
    // divide only by the span actually covered by data (clamped to the window).
    const allTxDates = [
      ...incomes.map((i) => i.receivedDate),
      ...expenses.map((e) => e.expenseDate),
    ];
    let dataSpanMonths = 0;
    if (allTxDates.length > 0) {
      // The query window is [windowStart, thisMonthStart) — it never includes the
      // current in-progress month, so the most recent possible bucket is last month,
      // not "now". Measuring span against `now` would over-count by one whenever the
      // most recent transaction is in that last completed month.
      const mostRecentBucket = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const earliest = new Date(Math.min(...allTxDates.map((d) => d.getTime())));
      const spanFromEarliest =
        (mostRecentBucket.getFullYear() - earliest.getFullYear()) * 12 +
        (mostRecentBucket.getMonth() - earliest.getMonth()) +
        1;
      dataSpanMonths = Math.min(MONTHS, Math.max(1, spanFromEarliest));
    }

    const totalIncome = monthlySeries.reduce((s, m) => s + m.income, 0);
    const totalExpense = monthlySeries.reduce((s, m) => s + m.expense, 0);
    const avgDivisor = Math.max(1, dataSpanMonths);
    const avgMonthlyIncome = totalIncome / avgDivisor;
    const avgMonthlyExpense = totalExpense / avgDivisor;
    const projectedMonthlySavings = avgMonthlyIncome - avgMonthlyExpense;
    const projectedSavingsAfter6Months = Math.round(projectedMonthlySavings * 6);

    // Forecast confidence scales with how long the user has actually been tracking —
    // shown to the UI so a 1-month forecast is never presented with the same
    // authority as a 6-month one, without blocking the feature outright.
    const confidence: 'LIMITED' | 'MODERATE' | 'GOOD' =
      dataSpanMonths >= 4 ? 'GOOD' : dataSpanMonths >= 2 ? 'MODERATE' : 'LIMITED';

    // Trend (recent half of the window vs. the earlier half) is only meaningful once
    // there's enough span to split in two — otherwise it's just comparing real months
    // against zero-padded ones.
    let trend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'NOT_ENOUGH_DATA' = 'NOT_ENOUGH_DATA';
    if (dataSpanMonths >= 4) {
      const earlierNet = monthlySeries.slice(0, 3).reduce((s, m) => s + (m.income - m.expense), 0);
      const recentNet = monthlySeries.slice(3).reduce((s, m) => s + (m.income - m.expense), 0);
      const trendThreshold = Math.abs(earlierNet) * 0.1 + 100;
      trend = 'STABLE';
      if (recentNet - earlierNet > trendThreshold) trend = 'IMPROVING';
      else if (earlierNet - recentNet > trendThreshold) trend = 'DECLINING';
    }

    // Biggest spending category over the window, for a concrete "you spend X% on Y" insight.
    const categoryTotals = new Map<string, number>();
    const monthsSeenByCategory = new Map<string, Set<string>>();
    for (const exp of expenses) {
      const name = exp.category?.name ?? 'Khác';
      categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + toAmount(exp.amount));
      if (!monthsSeenByCategory.has(name)) monthsSeenByCategory.set(name, new Set());
      monthsSeenByCategory.get(name)!.add(monthKey(exp.expenseDate));
    }
    const biggestCategoryEntry = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];
    const biggestCategory =
      biggestCategoryEntry && totalExpense > 0
        ? {
            name: biggestCategoryEntry[0],
            amount: Math.round(biggestCategoryEntry[1]),
            percent: Math.round((biggestCategoryEntry[1] / totalExpense) * 100),
          }
        : null;

    // No recurrence field exists on Income/Expense yet — approximate "recurring" spending
    // as a category that shows up in most months actually covered by data, rather than
    // adding new schema (out of scope here; a real recurrence model is a separate
    // feature). Threshold scales with dataSpanMonths so a 1-2 month-old account can't
    // have every category falsely flagged "recurring" off a single occurrence.
    const recurringThreshold = dataSpanMonths <= 1 ? Infinity : Math.max(2, Math.ceil(dataSpanMonths * 0.6));
    const recurringCategories = [...monthsSeenByCategory.entries()]
      .filter(([, months]) => months.size >= recurringThreshold)
      .map(([name, months]) => ({ name, monthsSeen: months.size }));

    const budget = budgets[0] ?? null;
    const currency = budget?.currency ?? incomes[0]?.currency ?? expenses[0]?.currency ?? 'VND';

    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (projectedMonthlySavings <= 0) riskLevel = 'HIGH';
    else if (avgMonthlyIncome > 0 && projectedMonthlySavings / avgMonthlyIncome < 0.1) riskLevel = 'MEDIUM';

    // Deterministic narrative/recommendations computed from hard numbers — this is what
    // ships when there's no AI key, and also what the AI response is validated against
    // (the AI only ever supplies the qualitative writeup, never the numbers themselves).
    const reduceCategoryMonthlyAmount = biggestCategory
      ? Math.round((biggestCategory.amount / MONTHS) * 0.15)
      : 0;
    const deterministicRecommendations: string[] = [];
    if (!budget) {
      deterministicRecommendations.push('Tạo ngân sách tháng để nhận phân tích và cảnh báo chính xác hơn.');
    }
    if (biggestCategory) {
      deterministicRecommendations.push(`Bạn chi ${biggestCategory.percent}% tổng chi tiêu cho ${biggestCategory.name}.`);
      if (reduceCategoryMonthlyAmount > 0) {
        deterministicRecommendations.push(
          `Nếu giảm chi cho ${biggestCategory.name} 15%, bạn có thể tiết kiệm thêm khoảng ${reduceCategoryMonthlyAmount.toLocaleString('vi-VN')} ${currency}/tháng.`,
        );
      }
    }
    if (riskLevel === 'HIGH') {
      deterministicRecommendations.push('Chi tiêu trung bình đang vượt thu nhập — hãy rà soát các khoản chi chưa cần thiết ngay.');
    } else if (budget) {
      const budgetLimit = toAmount(budget.totalLimit);
      if (budgetLimit > 0 && avgMonthlyExpense / budgetLimit > 0.9) {
        deterministicRecommendations.push('Bạn có khả năng vượt ngân sách tháng nếu duy trì tốc độ chi tiêu hiện tại.');
      }
    }

    const confidenceNote =
      confidence === 'LIMITED'
        ? ` Dự báo dựa trên ${dataSpanMonths} tháng dữ liệu — độ chính xác còn hạn chế và sẽ cải thiện khi bạn tiếp tục dùng Lumi.`
        : confidence === 'MODERATE'
          ? ` Dự báo dựa trên ${dataSpanMonths} tháng dữ liệu gần đây — độ chính xác ở mức trung bình.`
          : '';

    const deterministicNarrative = !hasAnyData
      ? 'Chưa có dữ liệu thu chi để dự báo. Hãy bắt đầu ghi lại thu nhập và chi tiêu để Lumi đưa ra dự báo dòng tiền cho bạn.'
      : trend === 'IMPROVING'
        ? `Tình hình tài chính đang cải thiện: tiết kiệm trung bình ${Math.round(projectedMonthlySavings).toLocaleString('vi-VN')} ${currency}/tháng trong 3 tháng gần đây, cao hơn giai đoạn trước.${confidenceNote}`
        : trend === 'DECLINING'
          ? `Tiết kiệm đang giảm dần so với 3 tháng trước — nên rà soát lại các khoản chi lớn hoặc không đều đặn.${confidenceNote}`
          : trend === 'NOT_ENOUGH_DATA'
            ? `Tiết kiệm trung bình khoảng ${Math.round(projectedMonthlySavings).toLocaleString('vi-VN')} ${currency}/tháng.${confidenceNote}`
            : `Tình hình tài chính khá ổn định, tiết kiệm trung bình ${Math.round(projectedMonthlySavings).toLocaleString('vi-VN')} ${currency}/tháng.${confidenceNote}`;

    let narrative = deterministicNarrative;
    let recommendations = deterministicRecommendations;
    let provider = 'deterministic';

    if (hasAnyData) {
      try {
        const prompt = this.buildCashflowForecastPrompt({
          avgMonthlyIncome: Math.round(avgMonthlyIncome),
          avgMonthlyExpense: Math.round(avgMonthlyExpense),
          projectedMonthlySavings: Math.round(projectedMonthlySavings),
          projectedSavingsAfter6Months,
          trend,
          riskLevel,
          biggestCategory,
          recurringCategories,
          currency,
          hasBudget: !!budget,
          dataSpanMonths,
          confidence,
        });
        const text = await this.chain.generateText(prompt);
        const parsed = text ? this.parseCashflowAiResponse(text) : null;
        if (parsed) {
          narrative = parsed.narrative || narrative;
          if (parsed.recommendations.length > 0) recommendations = parsed.recommendations;
          provider = 'ai';
        }
      } catch (err) {
        this.logger.warn('AI cashflow forecast failed, using deterministic fallback', err as Error);
      }
    }

    return {
      basedOnMonths: dataSpanMonths,
      windowMonths: MONTHS,
      confidence,
      currency,
      averageMonthlyIncome: Math.round(avgMonthlyIncome),
      averageMonthlyExpense: Math.round(avgMonthlyExpense),
      projectedMonthlySavings: Math.round(projectedMonthlySavings),
      projectedSavingsAfter6Months,
      trend,
      riskLevel,
      biggestCategory,
      recurringCategories,
      narrative,
      recommendations,
      provider,
    };
  }

  private buildCashflowForecastPrompt(data: {
    avgMonthlyIncome: number;
    avgMonthlyExpense: number;
    projectedMonthlySavings: number;
    projectedSavingsAfter6Months: number;
    trend: string;
    riskLevel: string;
    biggestCategory: { name: string; amount: number; percent: number } | null;
    recurringCategories: { name: string; monthsSeen: number }[];
    currency: string;
    hasBudget: boolean;
    dataSpanMonths: number;
    confidence: 'LIMITED' | 'MODERATE' | 'GOOD';
  }): string {
    return [
      'Bạn là một cố vấn tài chính cá nhân cho người Việt đang sinh sống tại Đài Loan.',
      `Dữ liệu ${data.dataSpanMonths} tháng gần đây của người dùng (đơn vị tiền tệ: ${data.currency}, độ tin cậy dữ liệu: ${data.confidence}):`,
      `- Thu nhập trung bình/tháng: ${data.avgMonthlyIncome.toLocaleString('vi-VN')}`,
      `- Chi tiêu trung bình/tháng: ${data.avgMonthlyExpense.toLocaleString('vi-VN')}`,
      `- Tiết kiệm dự kiến/tháng: ${data.projectedMonthlySavings.toLocaleString('vi-VN')}`,
      `- Tiết kiệm dự kiến sau 6 tháng: ${data.projectedSavingsAfter6Months.toLocaleString('vi-VN')}`,
      `- Xu hướng dòng tiền: ${data.trend}`,
      `- Mức rủi ro: ${data.riskLevel}`,
      `- Danh mục chi tiêu lớn nhất: ${data.biggestCategory ? `${data.biggestCategory.name} (${data.biggestCategory.percent}% tổng chi tiêu)` : 'không có dữ liệu'}`,
      `- Danh mục chi tiêu đều đặn hàng tháng: ${data.recurringCategories.map((c) => c.name).join(', ') || 'không có'}`,
      `- Đã thiết lập ngân sách tháng: ${data.hasBudget ? 'có' : 'chưa'}`,
      '',
      'Chỉ trả lời bằng JSON hợp lệ theo đúng định dạng sau, không thêm bất kỳ văn bản nào khác trước hoặc sau JSON:',
      '{"narrative": "1-2 câu nhận xét ngắn gọn, cụ thể về tình hình tài chính", "recommendations": ["gợi ý 1", "gợi ý 2", "gợi ý 3"]}',
      '',
      'Yêu cầu: mỗi gợi ý phải cụ thể, dựa trên số liệu đã cho ở trên (không bịa số liệu mới), bằng tiếng Việt, tối đa 30 từ mỗi gợi ý, tối đa 4 gợi ý.',
      data.confidence === 'LIMITED'
        ? `Lưu ý: dữ liệu chỉ có ${data.dataSpanMonths} tháng — narrative phải nêu rõ đây là ước tính ban đầu, không khẳng định chắc chắn.`
        : '',
    ].filter(Boolean).join('\n');
  }

  private parseCashflowAiResponse(text: string): { narrative: string; recommendations: string[] } | null {
    try {
      const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const obj = JSON.parse(match[0]) as { narrative?: unknown; recommendations?: unknown };
      if (typeof obj.narrative !== 'string' || !Array.isArray(obj.recommendations)) return null;
      const recommendations = obj.recommendations.filter((r): r is string => typeof r === 'string');
      if (!obj.narrative.trim() || recommendations.length === 0) return null;
      return { narrative: obj.narrative, recommendations };
    } catch {
      return null;
    }
  }

  async optimizeSchedule(userId: string) {
    const tasks = await this.prisma.task.findMany({ where: { userId, status: { in: ['TODO', 'OVERDUE', 'IN_PROGRESS'] } }, take: 20 });
    const overdue = tasks.filter((t) => t.status === 'OVERDUE');
    const suggestions: string[] = [];

    if (overdue.length > 0) suggestions.push(`Xử lý ${overdue.length} việc quá hạn trước tiên.`);
    if (tasks.length > 10) suggestions.push('Quá nhiều việc đang chờ — ưu tiên và loại bỏ các việc không cần thiết.');
    suggestions.push('Dùng tính năng tự động lên lịch để phân bổ công việc vào các khung giờ trống.');

    return { pendingTasks: tasks.length, overdueTasks: overdue.length, suggestions, provider: 'deterministic' };
  }

  async optimizeLearning(userId: string) {
    const [dueCount, activePlans, recentReviews] = await Promise.all([
      this.prisma.userVocabularyProgress.count({ where: { userId, nextReviewAt: { lte: new Date() } } }),
      this.prisma.learningPlan.count({ where: { userId, status: 'ACTIVE' } }),
      this.prisma.reviewSession.count({ where: { userId, reviewedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
    ]);

    const suggestions: string[] = [];
    if (dueCount > 0) suggestions.push(`Ôn lại ${dueCount} từ đang đến hạn ngay bây giờ.`);
    if (activePlans === 0) suggestions.push('Tạo kế hoạch học HSK để học có hệ thống hơn.');
    if (recentReviews < 7) suggestions.push('Mục tiêu: ôn tập ít nhất 1 lần mỗi ngày trong tuần.');

    return { dueWords: dueCount, activePlans, reviewSessionsThisWeek: recentReviews, suggestions, provider: 'deterministic' };
  }
}
