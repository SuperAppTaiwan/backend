import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { KnowledgeCategory, KnowledgeDifficulty, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import type { CreateArticleDto, UpdateArticleDto, CreateBookmarkDto } from './dto/knowledge.dto.js';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ─── Articles ──────────────────────────────────────────────────────────────

  async getArticles(params: {
    category?: KnowledgeCategory;
    difficulty?: KnowledgeDifficulty;
    search?: string;
    published?: boolean;
  }) {
    const where: Prisma.KnowledgeArticleWhereInput = {};

    if (params.category) where.category = params.category;
    if (params.difficulty) where.difficulty = params.difficulty;
    if (params.published !== undefined) {
      where.isPublished = params.published;
    } else {
      where.isPublished = true;
    }

    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { summary: { contains: params.search, mode: 'insensitive' } },
        { content: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.knowledgeArticle.findMany({
      where,
      select: {
        id: true,
        title: true,
        summary: true,
        category: true,
        difficulty: true,
        tagsJson: true,
        estimatedReadMinutes: true,
        viewCount: true,
        isPublished: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, displayName: true } },
        _count: { select: { bookmarks: true } },
      },
      orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getFeaturedArticles() {
    return this.prisma.knowledgeArticle.findMany({
      where: { isPublished: true },
      select: {
        id: true,
        title: true,
        summary: true,
        category: true,
        difficulty: true,
        tagsJson: true,
        estimatedReadMinutes: true,
        viewCount: true,
        createdAt: true,
        author: { select: { id: true, displayName: true } },
        _count: { select: { bookmarks: true } },
      },
      orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
      take: 10,
    });
  }

  async getArticle(userId: string, id: string) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id, isPublished: true },
      include: {
        author: { select: { id: true, displayName: true } },
        bookmarks: { where: { userId }, select: { id: true, notes: true } },
        _count: { select: { bookmarks: true } },
      },
    });
    if (!article) throw new NotFoundException('Article not found');

    await this.prisma.knowledgeArticle.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    await this.events.publish({
      userId,
      eventType: EventType.KNOWLEDGE_ARTICLE_VIEWED,
      sourceModule: 'knowledge',
      payload: { articleId: id, title: article.title },
    });

    return {
      ...article,
      isBookmarked: article.bookmarks.length > 0,
      bookmarkNotes: article.bookmarks[0]?.notes ?? null,
      bookmarkCount: article._count.bookmarks,
    };
  }

  async createArticle(userId: string, dto: CreateArticleDto) {
    const article = await this.prisma.knowledgeArticle.create({
      data: {
        authorId: userId,
        title: dto.title,
        summary: dto.summary,
        content: dto.content,
        category: dto.category ?? 'GENERAL',
        difficulty: dto.difficulty ?? 'BEGINNER',
        tagsJson: dto.tags ?? [],
        estimatedReadMinutes: dto.estimatedReadMinutes ?? 5,
        isPublished: dto.isPublished ?? true,
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.KNOWLEDGE_ARTICLE_CREATED,
      sourceModule: 'knowledge',
      payload: { articleId: article.id, title: article.title, category: article.category },
    });

    return article;
  }

  async updateArticle(userId: string, id: string, dto: UpdateArticleDto) {
    const existing = await this.prisma.knowledgeArticle.findFirst({ where: { id, authorId: userId } });
    if (!existing) throw new NotFoundException('Article not found');

    const updated = await this.prisma.knowledgeArticle.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.summary !== undefined && { summary: dto.summary }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.difficulty !== undefined && { difficulty: dto.difficulty }),
        ...(dto.tags !== undefined && { tagsJson: dto.tags }),
        ...(dto.estimatedReadMinutes !== undefined && { estimatedReadMinutes: dto.estimatedReadMinutes }),
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.KNOWLEDGE_ARTICLE_UPDATED,
      sourceModule: 'knowledge',
      payload: { articleId: id },
    });

    return updated;
  }

  async deleteArticle(userId: string, id: string) {
    const existing = await this.prisma.knowledgeArticle.findFirst({ where: { id, authorId: userId } });
    if (!existing) throw new NotFoundException('Article not found');

    await this.prisma.knowledgeArticle.delete({ where: { id } });

    await this.events.publish({
      userId,
      eventType: EventType.KNOWLEDGE_ARTICLE_DELETED,
      sourceModule: 'knowledge',
      payload: { articleId: id },
    });

    return { message: 'Article deleted' };
  }

  // ─── Bookmarks ─────────────────────────────────────────────────────────────

  async getBookmarks(userId: string) {
    return this.prisma.knowledgeBookmark.findMany({
      where: { userId },
      include: {
        article: {
          select: {
            id: true,
            title: true,
            summary: true,
            category: true,
            difficulty: true,
            estimatedReadMinutes: true,
            viewCount: true,
            tagsJson: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addBookmark(userId: string, articleId: string, dto: CreateBookmarkDto) {
    const article = await this.prisma.knowledgeArticle.findFirst({
      where: { id: articleId, isPublished: true },
    });
    if (!article) throw new NotFoundException('Article not found');

    const existing = await this.prisma.knowledgeBookmark.findUnique({
      where: { userId_articleId: { userId, articleId } },
    });
    if (existing) throw new ConflictException('Article already bookmarked');

    const bookmark = await this.prisma.knowledgeBookmark.create({
      data: { userId, articleId, notes: dto.notes },
    });

    await this.events.publish({
      userId,
      eventType: EventType.KNOWLEDGE_BOOKMARKED,
      sourceModule: 'knowledge',
      payload: { articleId, title: article.title },
    });

    return bookmark;
  }

  async removeBookmark(userId: string, articleId: string) {
    const existing = await this.prisma.knowledgeBookmark.findUnique({
      where: { userId_articleId: { userId, articleId } },
    });
    if (!existing) throw new NotFoundException('Bookmark not found');

    await this.prisma.knowledgeBookmark.delete({
      where: { userId_articleId: { userId, articleId } },
    });

    await this.events.publish({
      userId,
      eventType: EventType.KNOWLEDGE_UNBOOKMARKED,
      sourceModule: 'knowledge',
      payload: { articleId },
    });

    return { message: 'Bookmark removed' };
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  async searchArticles(query: string) {
    if (!query || query.trim().length < 2) return [];

    return this.prisma.knowledgeArticle.findMany({
      where: {
        isPublished: true,
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { summary: { contains: query, mode: 'insensitive' } },
          { content: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        title: true,
        summary: true,
        category: true,
        difficulty: true,
        estimatedReadMinutes: true,
        viewCount: true,
        tagsJson: true,
        createdAt: true,
      },
      orderBy: { viewCount: 'desc' },
      take: 20,
    });
  }
}
