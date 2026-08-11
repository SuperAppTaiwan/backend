import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { VocabularyStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { CreateVocabCategoryDto, UpdateVocabCategoryDto } from './dto/category.dto.js';
import { CreateVocabWordDto, UpdateVocabWordDto } from './dto/word.dto.js';
import { StartReviewDto } from './dto/review.dto.js';
import { selectReviewWords } from './review-selection.js';
import { nextReviewIntervalDays, nextReviewStatus } from './review-progress.js';

const DEFAULT_REVIEW_COUNT = 10;

@Injectable()
export class VocabNotebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ─── Categories ──────────────────────────────────────────────────────────

  async listCategories(userId: string) {
    const categories = await this.prisma.vocabCategory.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
    const counts = await this.prisma.vocabWord.groupBy({
      by: ['categoryId'],
      where: { userId, categoryId: { not: null } },
      _count: { _all: true },
    });
    const countByCategory = new Map(counts.map((c) => [c.categoryId, c._count._all]));

    return categories.map((c) => ({ ...c, wordCount: countByCategory.get(c.id) ?? 0 }));
  }

  async createCategory(userId: string, dto: CreateVocabCategoryDto) {
    const name = dto.name.trim();
    const existing = await this.prisma.vocabCategory.findFirst({ where: { userId, name } });
    if (existing) return existing;

    const category = await this.prisma.vocabCategory.create({ data: { userId, name } });
    await this.events.publish({
      userId,
      eventType: EventType.VOCAB_CATEGORY_CREATED,
      sourceModule: 'vocab-notebook',
      payload: { categoryId: category.id, name: category.name },
    });
    return category;
  }

  async updateCategory(userId: string, id: string, dto: UpdateVocabCategoryDto) {
    const category = await this.prisma.vocabCategory.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException('Category not found');

    const updated = await this.prisma.vocabCategory.update({
      where: { id },
      data: { name: dto.name?.trim() },
    });
    await this.events.publish({
      userId,
      eventType: EventType.VOCAB_CATEGORY_UPDATED,
      sourceModule: 'vocab-notebook',
      payload: { categoryId: id },
    });
    return updated;
  }

  async deleteCategory(userId: string, id: string) {
    const category = await this.prisma.vocabCategory.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException('Category not found');

    // Words in this category are kept — they just become uncategorized,
    // never silently deleted alongside their category.
    await this.prisma.vocabWord.updateMany({
      where: { userId, categoryId: id },
      data: { categoryId: null },
    });
    await this.prisma.vocabCategory.delete({ where: { id } });

    await this.events.publish({
      userId,
      eventType: EventType.VOCAB_CATEGORY_DELETED,
      sourceModule: 'vocab-notebook',
      payload: { categoryId: id },
    });
    return { message: 'Category deleted' };
  }

  // ─── Words ───────────────────────────────────────────────────────────────

  async listWords(userId: string, categoryId?: string, search?: string) {
    const words = await this.prisma.vocabWord.findMany({
      where: {
        userId,
        ...(categoryId && { categoryId }),
        ...(search && {
          OR: [
            { simplified: { contains: search, mode: 'insensitive' } },
            { traditional: { contains: search, mode: 'insensitive' } },
            { meaningVi: { contains: search, mode: 'insensitive' } },
            { simplifiedPinyin: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      include: { category: true, progress: true },
      orderBy: { createdAt: 'desc' },
    });
    return words;
  }

  async getWord(userId: string, id: string) {
    const word = await this.prisma.vocabWord.findFirst({
      where: { id, userId },
      include: { category: true, progress: true },
    });
    if (!word) throw new NotFoundException('Vocabulary word not found');
    return word;
  }

  async createWord(userId: string, dto: CreateVocabWordDto) {
    if (dto.categoryId) {
      await this.assertOwnsCategory(userId, dto.categoryId);
    }

    const word = await this.prisma.vocabWord.create({
      data: {
        userId,
        simplified: dto.simplified.trim(),
        simplifiedPinyin: dto.simplifiedPinyin.trim(),
        traditional: dto.traditional?.trim() || null,
        traditionalPinyin: dto.traditionalPinyin?.trim() || null,
        meaningVi: dto.meaningVi.trim(),
        example: dto.example?.trim() || null,
        categoryId: dto.categoryId ?? null,
      },
      include: { category: true },
    });

    await this.events.publish({
      userId,
      eventType: EventType.VOCAB_WORD_CREATED,
      sourceModule: 'vocab-notebook',
      payload: { vocabWordId: word.id, simplified: word.simplified },
    });
    return word;
  }

  async updateWord(userId: string, id: string, dto: UpdateVocabWordDto) {
    const word = await this.prisma.vocabWord.findFirst({ where: { id, userId } });
    if (!word) throw new NotFoundException('Vocabulary word not found');

    if (dto.categoryId) {
      await this.assertOwnsCategory(userId, dto.categoryId);
    }

    const updated = await this.prisma.vocabWord.update({
      where: { id },
      data: {
        ...(dto.simplified !== undefined && { simplified: dto.simplified.trim() }),
        ...(dto.simplifiedPinyin !== undefined && { simplifiedPinyin: dto.simplifiedPinyin.trim() }),
        ...(dto.traditional !== undefined && { traditional: dto.traditional?.trim() || null }),
        ...(dto.traditionalPinyin !== undefined && {
          traditionalPinyin: dto.traditionalPinyin?.trim() || null,
        }),
        ...(dto.meaningVi !== undefined && { meaningVi: dto.meaningVi.trim() }),
        ...(dto.example !== undefined && { example: dto.example?.trim() || null }),
        ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
      },
      include: { category: true },
    });

    await this.events.publish({
      userId,
      eventType: EventType.VOCAB_WORD_UPDATED,
      sourceModule: 'vocab-notebook',
      payload: { vocabWordId: id },
    });
    return updated;
  }

  async deleteWord(userId: string, id: string) {
    const word = await this.prisma.vocabWord.findFirst({ where: { id, userId } });
    if (!word) throw new NotFoundException('Vocabulary word not found');

    await this.prisma.vocabReviewProgress.deleteMany({ where: { userId, vocabWordId: id } });
    await this.prisma.vocabWord.delete({ where: { id } });

    await this.events.publish({
      userId,
      eventType: EventType.VOCAB_WORD_DELETED,
      sourceModule: 'vocab-notebook',
      payload: { vocabWordId: id },
    });
    return { message: 'Vocabulary word deleted' };
  }

  // ─── Overview ────────────────────────────────────────────────────────────

  async getOverview(userId: string) {
    const [totalWords, totalCategories, progressRows] = await Promise.all([
      this.prisma.vocabWord.count({ where: { userId } }),
      this.prisma.vocabCategory.count({ where: { userId } }),
      this.prisma.vocabReviewProgress.findMany({ where: { userId } }),
    ]);

    const now = new Date();
    const dueForReview = progressRows.filter(
      (p) =>
        (p.status === VocabularyStatus.LEARNING || p.status === VocabularyStatus.REVIEW) &&
        p.nextReviewAt !== null &&
        p.nextReviewAt <= now,
    ).length;
    const neverReviewed = totalWords - progressRows.length;

    return {
      totalWords,
      totalCategories,
      dueForReview: dueForReview + neverReviewed,
      learnedWords: progressRows.filter((p) => p.status === VocabularyStatus.LEARNED).length,
    };
  }

  // ─── Review sessions ─────────────────────────────────────────────────────

  async startReview(userId: string, dto: StartReviewDto) {
    if (dto.categoryId) {
      await this.assertOwnsCategory(userId, dto.categoryId);
    }

    const words = await this.prisma.vocabWord.findMany({
      where: { userId, ...(dto.categoryId && { categoryId: dto.categoryId }) },
      include: { category: true, progress: true },
    });

    if (words.length === 0) {
      return { words: [], emptyReason: 'NO_VOCABULARY' as const };
    }

    const count = dto.count ?? DEFAULT_REVIEW_COUNT;
    const selected = selectReviewWords(words, count);
    // Minted fresh per session and handed back to the client, which echoes it
    // on every /review/submit call in this session — lets selectReviewWords
    // identify "words from the immediately previous session" on the next
    // startReview without a dedicated session-history table.
    const sessionId = randomUUID();

    await this.events.publish({
      userId,
      eventType: EventType.VOCAB_REVIEW_SESSION_STARTED,
      sourceModule: 'vocab-notebook',
      payload: { categoryId: dto.categoryId ?? null, requested: count, selected: selected.length, sessionId },
    });

    return { words: selected, sessionId };
  }

  async submitWordReview(userId: string, vocabWordId: string, sessionId?: string) {
    const word = await this.prisma.vocabWord.findFirst({ where: { id: vocabWordId, userId } });
    if (!word) throw new NotFoundException('Vocabulary word not found');

    const existing = await this.prisma.vocabReviewProgress.findUnique({
      where: { vocabWordId },
    });

    const reviewCount = (existing?.reviewCount ?? 0) + 1;
    const status = nextReviewStatus(reviewCount);
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + nextReviewIntervalDays(reviewCount));
    const lastReviewSessionId = sessionId ?? null;

    const progress = await this.prisma.vocabReviewProgress.upsert({
      where: { vocabWordId },
      create: {
        userId,
        vocabWordId,
        status,
        familiarity: 1,
        reviewCount: 1,
        lastReviewedAt: new Date(),
        nextReviewAt,
        lastReviewSessionId,
      },
      update: {
        status,
        familiarity: { increment: 1 },
        reviewCount: { increment: 1 },
        lastReviewedAt: new Date(),
        nextReviewAt,
        lastReviewSessionId,
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.VOCAB_WORD_REVIEWED,
      sourceModule: 'vocab-notebook',
      payload: { vocabWordId, status, reviewCount: progress.reviewCount },
    });

    return progress;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async assertOwnsCategory(userId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.vocabCategory.findFirst({ where: { id: categoryId, userId } });
    if (!category) throw new NotFoundException('Category not found');
  }
}
