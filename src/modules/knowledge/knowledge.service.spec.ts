import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { KnowledgeCategory } from '@prisma/client';
import { KnowledgeService } from './knowledge.service.js';
import { CreateArticleDto, UpdateArticleDto } from './dto/knowledge.dto.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';

const mockPrisma = {
  knowledgeArticle: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  knowledgeBookmark: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
};

const mockEvents = { publish: jest.fn() };

describe('KnowledgeService', () => {
  let service: KnowledgeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: mockEvents },
      ],
    }).compile();

    service = module.get<KnowledgeService>(KnowledgeService);
    jest.clearAllMocks();
  });

  const userId = 'user-1';
  const articleId = 'article-1';

  const mockArticle = {
    id: articleId,
    authorId: userId,
    title: 'Cách xin ARC tại Đài Loan',
    summary: 'Hướng dẫn xin thẻ cư trú',
    content: 'Nội dung chi tiết...',
    category: 'LEGAL',
    difficulty: 'BEGINNER',
    tagsJson: ['ARC', 'visa'],
    estimatedReadMinutes: 5,
    isPublished: true,
    viewCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('getArticles', () => {
    it('returns published articles', async () => {
      mockPrisma.knowledgeArticle.findMany.mockResolvedValue([mockArticle]);
      const result = await service.getArticles({});
      expect(result).toEqual([mockArticle]);
      expect(mockPrisma.knowledgeArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isPublished: true }) }),
      );
    });

    it('filters by category', async () => {
      mockPrisma.knowledgeArticle.findMany.mockResolvedValue([mockArticle]);
      await service.getArticles({ category: KnowledgeCategory.LEGAL });
      expect(mockPrisma.knowledgeArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ category: 'LEGAL' }) }),
      );
    });

    it('includes search filter when provided', async () => {
      mockPrisma.knowledgeArticle.findMany.mockResolvedValue([]);
      await service.getArticles({ search: 'ARC' });
      const call = mockPrisma.knowledgeArticle.findMany.mock.calls[0][0];
      expect(call.where.OR).toBeDefined();
    });
  });

  describe('getFeaturedArticles', () => {
    it('returns top 10 articles ordered by viewCount', async () => {
      mockPrisma.knowledgeArticle.findMany.mockResolvedValue([mockArticle]);
      const result = await service.getFeaturedArticles();
      expect(result).toHaveLength(1);
      expect(mockPrisma.knowledgeArticle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  describe('getArticle', () => {
    it('returns article and increments view count', async () => {
      const articleWithRelations = {
        ...mockArticle,
        author: { id: userId, displayName: 'Test User' },
        bookmarks: [],
        _count: { bookmarks: 0 },
      };
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(articleWithRelations);
      mockPrisma.knowledgeArticle.update.mockResolvedValue({ ...mockArticle, viewCount: 1 });

      const result = await service.getArticle(userId, articleId);
      expect(result.id).toBe(articleId);
      expect(result.isBookmarked).toBe(false);
      expect(mockPrisma.knowledgeArticle.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { viewCount: { increment: 1 } } }),
      );
    });

    it('throws NotFoundException when article does not exist', async () => {
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(null);
      await expect(service.getArticle(userId, articleId)).rejects.toThrow(NotFoundException);
    });

    it('marks isBookmarked true when user has bookmark', async () => {
      const articleWithBookmark = {
        ...mockArticle,
        author: { id: userId, displayName: 'Test' },
        bookmarks: [{ id: 'bm-1', notes: null }],
        _count: { bookmarks: 1 },
      };
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(articleWithBookmark);
      mockPrisma.knowledgeArticle.update.mockResolvedValue(mockArticle);

      const result = await service.getArticle(userId, articleId);
      expect(result.isBookmarked).toBe(true);
    });
  });

  describe('createArticle', () => {
    it('creates article with defaults', async () => {
      const dto = { title: 'Test', summary: 'Summary', content: 'Content' };
      mockPrisma.knowledgeArticle.create.mockResolvedValue({ ...mockArticle, ...dto });

      const result = await service.createArticle(userId, dto as CreateArticleDto);
      expect(result.title).toBe('Test');
      expect(mockEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'KNOWLEDGE_ARTICLE_CREATED' }),
      );
    });
  });

  describe('updateArticle', () => {
    it('updates article when user is author', async () => {
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(mockArticle);
      const updated = { ...mockArticle, title: 'Updated' };
      mockPrisma.knowledgeArticle.update.mockResolvedValue(updated);

      const result = await service.updateArticle(userId, articleId, { title: 'Updated' } as UpdateArticleDto);
      expect(result.title).toBe('Updated');
    });

    it('throws NotFoundException when article not owned by user', async () => {
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(null);
      await expect(service.updateArticle(userId, articleId, {} as UpdateArticleDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteArticle', () => {
    it('deletes article when user is author', async () => {
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(mockArticle);
      mockPrisma.knowledgeArticle.delete.mockResolvedValue(mockArticle);

      const result = await service.deleteArticle(userId, articleId);
      expect(result.message).toBe('Article deleted');
    });

    it('throws NotFoundException when not owner', async () => {
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(null);
      await expect(service.deleteArticle(userId, articleId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBookmarks', () => {
    it('returns user bookmarks with article details', async () => {
      const bookmark = { id: 'bm-1', userId, articleId, article: mockArticle };
      mockPrisma.knowledgeBookmark.findMany.mockResolvedValue([bookmark]);

      const result = await service.getBookmarks(userId);
      expect(result).toHaveLength(1);
    });
  });

  describe('addBookmark', () => {
    it('creates bookmark for published article', async () => {
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(mockArticle);
      mockPrisma.knowledgeBookmark.findUnique.mockResolvedValue(null);
      const bookmark = { id: 'bm-1', userId, articleId };
      mockPrisma.knowledgeBookmark.create.mockResolvedValue(bookmark);

      const result = await service.addBookmark(userId, articleId, {});
      expect(result.id).toBe('bm-1');
    });

    it('throws NotFoundException when article not found', async () => {
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(null);
      await expect(service.addBookmark(userId, articleId, {})).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when already bookmarked', async () => {
      mockPrisma.knowledgeArticle.findFirst.mockResolvedValue(mockArticle);
      mockPrisma.knowledgeBookmark.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.addBookmark(userId, articleId, {})).rejects.toThrow(ConflictException);
    });
  });

  describe('removeBookmark', () => {
    it('removes bookmark', async () => {
      mockPrisma.knowledgeBookmark.findUnique.mockResolvedValue({ id: 'bm-1' });
      mockPrisma.knowledgeBookmark.delete.mockResolvedValue({ id: 'bm-1' });

      const result = await service.removeBookmark(userId, articleId);
      expect(result.message).toBe('Bookmark removed');
    });

    it('throws NotFoundException when bookmark not found', async () => {
      mockPrisma.knowledgeBookmark.findUnique.mockResolvedValue(null);
      await expect(service.removeBookmark(userId, articleId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('searchArticles', () => {
    it('returns empty array for short query', async () => {
      const result = await service.searchArticles('a');
      expect(result).toEqual([]);
      expect(mockPrisma.knowledgeArticle.findMany).not.toHaveBeenCalled();
    });

    it('searches articles with OR conditions', async () => {
      mockPrisma.knowledgeArticle.findMany.mockResolvedValue([mockArticle]);
      const result = await service.searchArticles('ARC');
      expect(result).toHaveLength(1);
    });
  });
});
