import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewResult, VocabularyStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { CreateVocabCategoryDto, UpdateVocabCategoryDto } from './dto/category.dto.js';
import { BulkVocabWordItemDto, CreateVocabWordDto, UpdateVocabWordDto } from './dto/word.dto.js';
import { StartReviewDto } from './dto/review.dto.js';
import { selectReviewWords } from './review-selection.js';
import { normalizeTraditionalFields } from './vocab-word-normalization.js';
import {
  nextFamiliarityFromResult,
  nextReviewIntervalDays,
  nextReviewIntervalDaysFromResult,
  nextReviewStatus,
  nextReviewStatusFromResult,
} from './review-progress.js';

const DEFAULT_REVIEW_COUNT = 10;

export interface BulkImportRowResult {
  index: number;
  simplified?: string;
  status: 'created' | 'skipped' | 'failed';
  reason?: string;
}

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
    // Belt-and-suspenders alongside the DTO's @Matches(/\S/) — never persist
    // a blank category name (it renders as an empty, unusable filter chip).
    if (!name) throw new BadRequestException('Category name must not be blank');

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

    const trimmedName = dto.name?.trim();
    if (dto.name !== undefined && !trimmedName) {
      throw new BadRequestException('Category name must not be blank');
    }

    const updated = await this.prisma.vocabCategory.update({
      where: { id },
      data: { ...(trimmedName !== undefined && { name: trimmedName }) },
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

    const simplified = dto.simplified.trim();
    const simplifiedPinyin = dto.simplifiedPinyin.trim();
    const { traditional, traditionalPinyin } = normalizeTraditionalFields({
      simplified, simplifiedPinyin, traditional: dto.traditional, traditionalPinyin: dto.traditionalPinyin,
    });

    const word = await this.prisma.vocabWord.create({
      data: {
        userId,
        simplified,
        simplifiedPinyin,
        traditional,
        traditionalPinyin,
        meaningVi: dto.meaningVi.trim(),
        example: dto.example?.trim() || null,
        examplePinyin: dto.examplePinyin?.trim() || null,
        exampleVietnamese: dto.exampleVietnamese?.trim() || null,
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

  // ─── Bulk import (e.g. pasted from a spreadsheet) ───────────────────────────

  async bulkCreateWords(userId: string, items: BulkVocabWordItemDto[]) {
    // Two batched lookups instead of one query per row: category ownership
    // and existing-word duplicates. Both need to reject/skip individual rows
    // rather than the whole request, so validation happens in a single pass
    // here instead of via ValidationPipe/CreateVocabWordDto.
    const requestedCategoryIds = [...new Set(items.map((i) => i.categoryId).filter((id): id is string => !!id))];
    const ownedCategories = requestedCategoryIds.length
      ? await this.prisma.vocabCategory.findMany({
          where: { id: { in: requestedCategoryIds }, userId },
          select: { id: true },
        })
      : [];
    const ownedCategoryIds = new Set(ownedCategories.map((c) => c.id));

    const existingWords = await this.prisma.vocabWord.findMany({
      where: { userId },
      select: { simplified: true },
    });
    const existingSimplified = new Set(existingWords.map((w) => w.simplified));

    const results: BulkImportRowResult[] = [];
    const seenInBatch = new Set<string>();
    const toCreate: Prisma.VocabWordCreateManyInput[] = [];

    items.forEach((item, index) => {
      const simplified = item.simplified?.trim();
      const simplifiedPinyin = item.simplifiedPinyin?.trim();
      const meaningVi = item.meaningVi?.trim();

      if (!simplified) {
        results.push({ index, status: 'failed', reason: 'Thiếu chữ giản thể' });
        return;
      }
      if (!simplifiedPinyin) {
        results.push({ index, simplified, status: 'failed', reason: 'Thiếu pinyin giản thể' });
        return;
      }
      if (!meaningVi) {
        results.push({ index, simplified, status: 'failed', reason: 'Thiếu nghĩa tiếng Việt' });
        return;
      }
      // Never trust a client-supplied categoryId — reject rather than
      // silently drop, so the user gets a clear reason instead of a word
      // that quietly landed with no category.
      if (item.categoryId && !ownedCategoryIds.has(item.categoryId)) {
        results.push({ index, simplified, status: 'failed', reason: 'Danh mục không hợp lệ' });
        return;
      }
      if (existingSimplified.has(simplified) || seenInBatch.has(simplified)) {
        results.push({ index, simplified, status: 'skipped', reason: 'Đã tồn tại' });
        return;
      }

      seenInBatch.add(simplified);
      const { traditional, traditionalPinyin } = normalizeTraditionalFields({
        simplified, simplifiedPinyin, traditional: item.traditional, traditionalPinyin: item.traditionalPinyin,
      });
      toCreate.push({
        userId,
        simplified,
        simplifiedPinyin,
        traditional,
        traditionalPinyin,
        meaningVi,
        example: item.example?.trim() || null,
        examplePinyin: item.examplePinyin?.trim() || null,
        exampleVietnamese: item.exampleVietnamese?.trim() || null,
        categoryId: item.categoryId ?? null,
      });
      results.push({ index, simplified, status: 'created' });
    });

    if (toCreate.length > 0) {
      try {
        await this.prisma.vocabWord.createMany({ data: toCreate });
      } catch {
        // The batch insert itself failed (rare — a DB-level issue, not a
        // per-row validation problem). Reclassify every row that was about
        // to be created rather than reporting a false "created" count.
        const failingSimplified = new Set(toCreate.map((c) => c.simplified as string));
        for (const r of results) {
          if (r.status === 'created' && r.simplified && failingSimplified.has(r.simplified)) {
            r.status = 'failed';
            r.reason = 'Lỗi khi lưu vào cơ sở dữ liệu';
          }
        }
      }
    }

    const created = results.filter((r) => r.status === 'created').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    if (created > 0) {
      await this.events.publish({
        userId,
        eventType: EventType.VOCAB_WORD_BULK_CREATED,
        sourceModule: 'vocab-notebook',
        payload: { created, skipped, failed, total: items.length },
      });
    }

    return { created, skipped, failed, results };
  }

  async updateWord(userId: string, id: string, dto: UpdateVocabWordDto) {
    const word = await this.prisma.vocabWord.findFirst({ where: { id, userId } });
    if (!word) throw new NotFoundException('Vocabulary word not found');

    if (dto.categoryId) {
      await this.assertOwnsCategory(userId, dto.categoryId);
    }

    // Effective simplified/pinyin (this update's value, or the existing one)
    // are what a cleared Traditional field falls back to — only recomputed
    // when Traditional/TraditionalPinyin are actually being touched in this
    // request, so editing unrelated fields never silently overwrites an
    // already-different Traditional value (spec: never replace a non-empty
    // Traditional with Simplified just because Simplified changed).
    const effectiveSimplified = dto.simplified?.trim() ?? word.simplified;
    const effectiveSimplifiedPinyin = dto.simplifiedPinyin?.trim() ?? word.simplifiedPinyin;

    const updated = await this.prisma.vocabWord.update({
      where: { id },
      data: {
        ...(dto.simplified !== undefined && { simplified: effectiveSimplified }),
        ...(dto.simplifiedPinyin !== undefined && { simplifiedPinyin: effectiveSimplifiedPinyin }),
        ...(dto.traditional !== undefined && {
          traditional: normalizeTraditionalFields({
            simplified: effectiveSimplified, simplifiedPinyin: effectiveSimplifiedPinyin, traditional: dto.traditional,
          }).traditional,
        }),
        ...(dto.traditionalPinyin !== undefined && {
          traditionalPinyin: normalizeTraditionalFields({
            simplified: effectiveSimplified, simplifiedPinyin: effectiveSimplifiedPinyin, traditionalPinyin: dto.traditionalPinyin,
          }).traditionalPinyin,
        }),
        ...(dto.meaningVi !== undefined && { meaningVi: dto.meaningVi.trim() }),
        ...(dto.example !== undefined && { example: dto.example?.trim() || null }),
        ...(dto.examplePinyin !== undefined && { examplePinyin: dto.examplePinyin?.trim() || null }),
        ...(dto.exampleVietnamese !== undefined && { exampleVietnamese: dto.exampleVietnamese?.trim() || null }),
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

  async submitWordReview(userId: string, vocabWordId: string, sessionId?: string, result?: ReviewResult) {
    const word = await this.prisma.vocabWord.findFirst({ where: { id: vocabWordId, userId } });
    if (!word) throw new NotFoundException('Vocabulary word not found');

    const existing = await this.prisma.vocabReviewProgress.findUnique({
      where: { vocabWordId },
    });

    const reviewCount = (existing?.reviewCount ?? 0) + 1;
    const lastReviewSessionId = sessionId ?? null;
    const nextReviewAt = new Date();

    // Two progression curves share the same VocabReviewProgress row: a plain
    // reviewCount-based ladder (handwriting-trace flow, no `result`) and a
    // difficulty-rated one (Quick Review's flip-card AGAIN/HARD/GOOD/EASY,
    // mirroring the legacy learning module's SRS curve — see review-progress.ts).
    let status: VocabularyStatus;
    let familiarity: number;
    let intervalDays: number;
    if (result) {
      status = nextReviewStatusFromResult(result);
      familiarity = nextFamiliarityFromResult(existing?.familiarity ?? 0, result);
      intervalDays = nextReviewIntervalDaysFromResult(result);
    } else {
      status = nextReviewStatus(reviewCount);
      familiarity = (existing?.familiarity ?? 0) + 1;
      intervalDays = nextReviewIntervalDays(reviewCount);
    }
    nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays);

    const progress = await this.prisma.vocabReviewProgress.upsert({
      where: { vocabWordId },
      create: {
        userId,
        vocabWordId,
        status,
        familiarity: result ? familiarity : 1,
        reviewCount: 1,
        lastReviewedAt: new Date(),
        nextReviewAt,
        lastReviewSessionId,
      },
      update: {
        status,
        familiarity: result ? { set: familiarity } : { increment: 1 },
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
