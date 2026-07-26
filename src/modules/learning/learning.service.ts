import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReviewResult, VocabularyStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { CreateVocabularyDto } from './dto/create-vocabulary.dto.js';
import { UpdateVocabularyDto } from './dto/update-vocabulary.dto.js';
import { ReviewDto } from './dto/review.dto.js';
import { CreateLearningPlanDto, UpdateLearningPlanDto } from './dto/create-learning-plan.dto.js';
import { HskPlanDto } from './dto/hsk-plan.dto.js';

const HSK_WORD_COUNTS: Record<number, number> = {
  1: 150, 2: 150, 3: 300, 4: 600, 5: 1300, 6: 2500, 7: 3000, 8: 4000, 9: 5000,
};

const DEFAULT_VOCAB: Omit<CreateVocabularyDto, 'source'>[] = [
  {
    traditional: '你好', simplified: '你好', pinyin: 'nǐ hǎo',
    meaningVi: 'Xin chào', meaningEn: 'Hello',
    exampleTraditional: '你好，你叫什麼名字？', exampleSimplified: '你好，你叫什么名字？',
    examplePinyin: 'Nǐ hǎo, nǐ jiào shénme míngzì?', exampleMeaningVi: 'Xin chào, bạn tên gì?',
    hskLevel: 1, topic: 'greeting',
  },
  {
    traditional: '謝謝', simplified: '谢谢', pinyin: 'xiè xiè',
    meaningVi: 'Cảm ơn', meaningEn: 'Thank you',
    exampleTraditional: '謝謝你的幫助。', exampleSimplified: '谢谢你的帮助。',
    examplePinyin: 'Xièxiè nǐ de bāngzhù.', exampleMeaningVi: 'Cảm ơn bạn đã giúp đỡ.',
    hskLevel: 1, topic: 'courtesy',
  },
  {
    traditional: '學習', simplified: '学习', pinyin: 'xué xí',
    meaningVi: 'Học tập', meaningEn: 'To learn, to study',
    exampleTraditional: '我每天都在學習中文。', exampleSimplified: '我每天都在学习中文。',
    examplePinyin: 'Wǒ měitiān dōu zài xuéxí zhōngwén.', exampleMeaningVi: 'Tôi học tiếng Trung mỗi ngày.',
    hskLevel: 2, topic: 'education',
  },
  {
    traditional: '工作', simplified: '工作', pinyin: 'gōng zuò',
    meaningVi: 'Làm việc, công việc', meaningEn: 'Work, to work',
    exampleTraditional: '你在哪裡工作？', exampleSimplified: '你在哪里工作？',
    examplePinyin: 'Nǐ zài nǎlǐ gōngzuò?', exampleMeaningVi: 'Bạn làm việc ở đâu?',
    hskLevel: 1, topic: 'daily',
  },
  {
    traditional: '朋友', simplified: '朋友', pinyin: 'péng yǒu',
    meaningVi: 'Bạn bè', meaningEn: 'Friend',
    exampleTraditional: '他是我最好的朋友。', exampleSimplified: '他是我最好的朋友。',
    examplePinyin: 'Tā shì wǒ zuì hǎo de péngyǒu.', exampleMeaningVi: 'Anh ấy là người bạn tốt nhất của tôi.',
    hskLevel: 1, topic: 'social',
  },
];

function nextReviewDate(result: ReviewResult, _familiarity: number): Date {
  const now = new Date();
  const days = result === 'AGAIN' ? 1 : result === 'HARD' ? 2 : result === 'GOOD' ? 4 : 7;
  now.setDate(now.getDate() + days);
  return now;
}

function newFamiliarity(current: number, result: ReviewResult): number {
  if (result === 'AGAIN') return Math.max(0, current - 1);
  if (result === 'EASY') return Math.min(10, current + 1);
  return current;
}

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ─── Seed ────────────────────────────────────────────────────────────────────

  private async ensureSeedVocab(): Promise<void> {
    const count = await this.prisma.vocabulary.count({ where: { source: 'system' } });
    if (count > 0) return;
    await this.prisma.vocabulary.createMany({
      data: DEFAULT_VOCAB.map((v) => ({ ...v, source: 'system' })),
    });
  }

  // ─── Vocabulary CRUD ─────────────────────────────────────────────────────────

  async createVocabulary(userId: string, dto: CreateVocabularyDto) {
    const vocab = await this.prisma.vocabulary.create({
      data: { ...dto, source: dto.source ?? 'user' },
    });
    await this.events.publish({
      userId,
      eventType: EventType.VOCABULARY_CREATED,
      sourceModule: 'learning',
      payload: { vocabularyId: vocab.id, traditional: vocab.traditional },
    });
    return vocab;
  }

  async findAllVocabularies() {
    await this.ensureSeedVocab();
    return this.prisma.vocabulary.findMany({ orderBy: { hskLevel: 'asc' } });
  }

  async findVocabularyById(id: string) {
    const vocab = await this.prisma.vocabulary.findUnique({ where: { id } });
    if (!vocab) throw new NotFoundException('Vocabulary not found');
    return vocab;
  }

  async updateVocabulary(userId: string, id: string, dto: UpdateVocabularyDto) {
    const vocab = await this.prisma.vocabulary.findUnique({ where: { id } });
    if (!vocab) throw new NotFoundException('Vocabulary not found');
    if (vocab.source !== 'user') throw new ForbiddenException('Cannot modify system vocabulary');
    return this.prisma.vocabulary.update({ where: { id }, data: dto });
  }

  async deleteVocabulary(userId: string, id: string) {
    const vocab = await this.prisma.vocabulary.findUnique({ where: { id } });
    if (!vocab) throw new NotFoundException('Vocabulary not found');
    if (vocab.source !== 'user') throw new ForbiddenException('Cannot delete system vocabulary');
    await this.prisma.vocabulary.delete({ where: { id } });
    return { message: 'Vocabulary deleted' };
  }

  // ─── Daily Vocabulary ────────────────────────────────────────────────────────

  async getDailyVocabulary(userId: string) {
    await this.ensureSeedVocab();

    const plan = await this.prisma.learningPlan.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    const dailyTarget = plan?.dailyWordTarget ?? 2;

    const dueReview = await this.prisma.userVocabularyProgress.findMany({
      where: {
        userId,
        status: { in: ['LEARNING', 'REVIEW'] },
        nextReviewAt: { lte: new Date() },
      },
      include: { vocabulary: true },
      take: dailyTarget,
      orderBy: { nextReviewAt: 'asc' },
    });

    if (dueReview.length >= dailyTarget) {
      return {
        words: dueReview.map((p) => ({ ...p.vocabulary, userStatus: p.status, familiarity: p.familiarity })),
        totalDue: dueReview.length,
        isDue: true,
      };
    }

    const learnedIds = await this.prisma.userVocabularyProgress.findMany({
      where: { userId },
      select: { vocabularyId: true },
    });
    const excludeIds = learnedIds.map((p) => p.vocabularyId);

    const newWords = await this.prisma.vocabulary.findMany({
      where: { id: { notIn: excludeIds } },
      take: dailyTarget - dueReview.length,
      orderBy: [{ hskLevel: 'asc' }, { createdAt: 'asc' }],
    });

    const combined = [
      ...dueReview.map((p) => ({ ...p.vocabulary, userStatus: p.status, familiarity: p.familiarity })),
      ...newWords.map((v) => ({ ...v, userStatus: 'NEW' as VocabularyStatus, familiarity: 0 })),
    ];

    return { words: combined, totalDue: combined.length, isDue: dueReview.length > 0 };
  }

  // ─── Mark learned / bookmark ─────────────────────────────────────────────────

  async markLearned(userId: string, vocabularyId: string) {
    const vocab = await this.prisma.vocabulary.findUnique({ where: { id: vocabularyId } });
    if (!vocab) throw new NotFoundException('Vocabulary not found');

    const progress = await this.prisma.userVocabularyProgress.upsert({
      where: { userId_vocabularyId: { userId, vocabularyId } },
      create: {
        userId, vocabularyId, status: 'LEARNED', familiarity: 5,
        learnedAt: new Date(), nextReviewAt: new Date(Date.now() + 4 * 86400_000),
      },
      update: {
        status: 'LEARNED', learnedAt: new Date(),
        nextReviewAt: new Date(Date.now() + 4 * 86400_000),
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.VOCABULARY_LEARNED,
      sourceModule: 'learning',
      payload: { vocabularyId, traditional: vocab.traditional },
    });

    return progress;
  }

  async bookmarkVocabulary(userId: string, vocabularyId: string) {
    const vocab = await this.prisma.vocabulary.findUnique({ where: { id: vocabularyId } });
    if (!vocab) throw new NotFoundException('Vocabulary not found');

    const progress = await this.prisma.userVocabularyProgress.upsert({
      where: { userId_vocabularyId: { userId, vocabularyId } },
      create: { userId, vocabularyId, status: 'LEARNING', nextReviewAt: new Date() },
      update: { status: 'LEARNING' },
    });
    return progress;
  }

  // ─── Review ──────────────────────────────────────────────────────────────────

  async submitReview(userId: string, dto: ReviewDto) {
    const vocab = await this.prisma.vocabulary.findUnique({ where: { id: dto.vocabularyId } });
    if (!vocab) throw new NotFoundException('Vocabulary not found');

    const existing = await this.prisma.userVocabularyProgress.findUnique({
      where: { userId_vocabularyId: { userId, vocabularyId: dto.vocabularyId } },
    });

    const familiarity = newFamiliarity(existing?.familiarity ?? 0, dto.result);
    const nextReview = nextReviewDate(dto.result, familiarity);
    const newStatus: VocabularyStatus = dto.result === 'EASY' ? 'LEARNED'
      : dto.result === 'AGAIN' ? 'LEARNING' : 'REVIEW';

    const progress = await this.prisma.userVocabularyProgress.upsert({
      where: { userId_vocabularyId: { userId, vocabularyId: dto.vocabularyId } },
      create: {
        userId, vocabularyId: dto.vocabularyId, status: newStatus,
        familiarity, reviewCount: 1, lastReviewedAt: new Date(), nextReviewAt: nextReview,
      },
      update: {
        status: newStatus, familiarity,
        reviewCount: { increment: 1 },
        lastReviewedAt: new Date(),
        nextReviewAt: nextReview,
      },
    });

    await this.prisma.reviewSession.create({
      data: { userId, vocabularyId: dto.vocabularyId, result: dto.result, score: dto.score, note: dto.note },
    });

    await this.events.publish({
      userId,
      eventType: EventType.VOCABULARY_REVIEWED,
      sourceModule: 'learning',
      payload: { vocabularyId: dto.vocabularyId, result: dto.result, familiarity },
    });

    return progress;
  }

  // ─── Progress ─────────────────────────────────────────────────────────────────

  async getProgress(userId: string) {
    const [totalWords, progressRows, dueCount] = await Promise.all([
      this.prisma.vocabulary.count(),
      this.prisma.userVocabularyProgress.findMany({ where: { userId } }),
      this.prisma.userVocabularyProgress.count({
        where: { userId, nextReviewAt: { lte: new Date() }, status: { in: ['LEARNING', 'REVIEW'] } },
      }),
    ]);

    const byStatus = {
      NEW: totalWords - progressRows.length,
      LEARNING: 0, LEARNED: 0, REVIEW: 0,
    };

    for (const p of progressRows) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reviewedToday = progressRows.filter(
      (p) => p.lastReviewedAt && p.lastReviewedAt >= today,
    ).length;

    return {
      totalWords,
      learnedWords: byStatus.LEARNED,
      reviewDueCount: dueCount,
      reviewedToday,
      wordsByStatus: byStatus,
    };
  }

  // ─── Learning Plan ───────────────────────────────────────────────────────────

  async createPlan(userId: string, dto: CreateLearningPlanDto) {
    const plan = await this.prisma.learningPlan.create({
      data: {
        userId,
        title: dto.title,
        targetLevel: dto.targetLevel,
        dailyWordTarget: dto.dailyWordTarget ?? 2,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
    });
    await this.events.publish({
      userId,
      eventType: EventType.LEARNING_PLAN_CREATED,
      sourceModule: 'learning',
      payload: { planId: plan.id, title: plan.title },
    });
    return plan;
  }

  async getPlans(userId: string) {
    return this.prisma.learningPlan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updatePlan(userId: string, id: string, dto: UpdateLearningPlanDto) {
    const plan = await this.prisma.learningPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.userId !== userId) throw new ForbiddenException();
    return this.prisma.learningPlan.update({ where: { id }, data: dto });
  }

  // ─── HSK Plan ────────────────────────────────────────────────────────────────

  async createHskPlan(userId: string, dto: HskPlanDto) {
    const wordsNeeded = HSK_WORD_COUNTS[dto.targetLevel] ?? 300;
    const targetDate = new Date(dto.targetDate);
    const today = new Date();
    const daysLeft = Math.max(1, Math.ceil((targetDate.getTime() - today.getTime()) / 86400_000));
    const dailyTarget = dto.dailyWordTarget ?? Math.max(2, Math.ceil(wordsNeeded / daysLeft));

    const plan = await this.prisma.learningPlan.create({
      data: {
        userId,
        title: `HSK ${dto.targetLevel} — ${wordsNeeded} từ trong ${daysLeft} ngày`,
        targetLevel: `HSK${dto.targetLevel}`,
        dailyWordTarget: dailyTarget,
        startDate: today,
        endDate: targetDate,
        metadataJson: { hskLevel: dto.targetLevel, wordsNeeded, daysLeft, dailyTarget },
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.HSK_GOAL_CREATED,
      sourceModule: 'learning',
      payload: { planId: plan.id, targetLevel: dto.targetLevel, wordsNeeded, daysLeft },
    });

    return {
      plan,
      summary: {
        targetLevel: `HSK${dto.targetLevel}`,
        wordsNeeded,
        daysLeft,
        dailyWordTarget: dailyTarget,
        projectedCompletionDate: targetDate.toISOString().split('T')[0],
      },
    };
  }

  // ─── Weekly Report ───────────────────────────────────────────────────────────

  async getWeeklyReport(userId: string) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [sessions, newlyLearned] = await Promise.all([
      this.prisma.reviewSession.findMany({
        where: { userId, reviewedAt: { gte: oneWeekAgo } },
      }),
      this.prisma.userVocabularyProgress.findMany({
        where: { userId, learnedAt: { gte: oneWeekAgo } },
      }),
    ]);

    const byDay: Record<string, number> = {};
    for (const s of sessions) {
      const day = s.reviewedAt.toISOString().split('T')[0];
      byDay[day] = (byDay[day] ?? 0) + 1;
    }
    const activeDays = Object.keys(byDay).length;

    const resultCounts = sessions.reduce<Record<string, number>>((acc, s) => {
      acc[s.result] = (acc[s.result] ?? 0) + 1;
      return acc;
    }, {});

    let suggestion = 'Giữ vững đà học mỗi ngày!';
    if (activeDays < 3) suggestion = 'Cố gắng học ít nhất 5 ngày mỗi tuần để đạt hiệu quả tốt nhất.';
    else if ((resultCounts['AGAIN'] ?? 0) > sessions.length / 2) suggestion = 'Nhiều từ cần ôn lại — hãy tập trung vào các từ khó.';
    else if (newlyLearned.length >= 10) suggestion = 'Xuất sắc! Bạn đã học được nhiều từ mới trong tuần này.';

    return {
      weekStart: oneWeekAgo.toISOString().split('T')[0],
      weekEnd: new Date().toISOString().split('T')[0],
      totalReviews: sessions.length,
      newWordsLearned: newlyLearned.length,
      activeDays,
      reviewsByDay: byDay,
      resultBreakdown: resultCounts,
      suggestion,
    };
  }
}
