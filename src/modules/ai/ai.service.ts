import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AISuggestionStatus, AISuggestionType, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { DeterministicAIProvider } from './providers/deterministic-ai.provider.js';
import { ClaudeAIProvider } from './providers/claude-ai.provider.js';
import type { AIProvider, AIChatMessage } from './providers/ai-provider.interface.js';

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
    private readonly claudeProvider: ClaudeAIProvider,
  ) {}

  private getProvider(): AIProvider {
    return this.claudeProvider.isAvailable() ? this.claudeProvider : this.deterministicProvider;
  }

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
    const [suggestions, profile, learningProgress, tasks] = await Promise.allSettled([
      this.prisma.aISuggestion.findMany({ where: { userId, status: 'ACTIVE' }, take: 5, orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }] }),
      this.getOrCreateProfile(userId),
      this.prisma.userVocabularyProgress.count({ where: { userId, nextReviewAt: { lte: new Date() } } }),
      this.prisma.task.findMany({ where: { userId, status: { in: ['TODO', 'OVERDUE'] } }, take: 5, orderBy: { priority: 'asc' } }),
    ]);

    const context = {
      finance: { netSavings: 0 },
      learning: { reviewDueCount: learningProgress.status === 'fulfilled' ? learningProgress.value : 0 },
      schedule: { overdueTasks: 0, completedThisWeek: 0 },
    };

    const provider = this.getProvider();
    let summary: string;
    let providerName: string;
    try {
      const result = await provider.generateSummary({ userId, context });
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
    const provider = this.getProvider();
    let result: { message: string; provider: string };
    try {
      result = await provider.chat(messages);
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
    const provider = this.getProvider();
    let result: { message: string; provider: string };
    try {
      result = await provider.chat(messages);
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
