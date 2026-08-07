import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { VocabularyStatus } from '@prisma/client';
import { VocabNotebookService } from './vocab-notebook.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';

const mockCategory = (overrides = {}) => ({
  id: 'cat1',
  userId: 'u1',
  name: 'Work',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const mockWord = (overrides = {}) => ({
  id: 'w1',
  userId: 'u1',
  categoryId: null,
  simplified: '工作',
  simplifiedPinyin: 'gōng zuò',
  traditional: '工作',
  traditionalPinyin: 'gōng zuò',
  meaningVi: 'Làm việc',
  example: '我每天工作八个小时。',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('VocabNotebookService', () => {
  let service: VocabNotebookService;
  let prisma: jest.Mocked<PrismaService>;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VocabNotebookService,
        {
          provide: PrismaService,
          useValue: {
            vocabCategory: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            vocabWord: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
              groupBy: jest.fn(),
            },
            vocabReviewProgress: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
        {
          provide: EventsService,
          useValue: { publish: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(VocabNotebookService);
    prisma = module.get(PrismaService);
    eventsService = module.get(EventsService);
  });

  // ─── Ownership / IDOR isolation ─────────────────────────────────────────

  describe('ownership isolation', () => {
    it('returns 404 (not 403) when getting another user\'s word', async () => {
      (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getWord('attacker', 'w1')).rejects.toThrow(NotFoundException);
      expect(prisma.vocabWord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'w1', userId: 'attacker' } }),
      );
    });

    it('returns 404 when updating another user\'s word', async () => {
      (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateWord('attacker', 'w1', { meaningVi: 'hacked' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.vocabWord.update).not.toHaveBeenCalled();
    });

    it('returns 404 when deleting another user\'s word', async () => {
      (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteWord('attacker', 'w1')).rejects.toThrow(NotFoundException);
      expect(prisma.vocabWord.delete).not.toHaveBeenCalled();
    });

    it('returns 404 when assigning a word to a category owned by someone else', async () => {
      (prisma.vocabCategory.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createWord('u1', {
          simplified: '工作',
          simplifiedPinyin: 'gōng zuò',
          meaningVi: 'Làm việc',
          categoryId: 'someone-elses-category',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.vocabWord.create).not.toHaveBeenCalled();
    });

    it('scopes listWords to the requesting user only', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      await service.listWords('u1');
      expect(prisma.vocabWord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
      );
    });
  });

  // ─── Categories ──────────────────────────────────────────────────────────

  describe('categories', () => {
    it('creates a category and publishes an event', async () => {
      (prisma.vocabCategory.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.vocabCategory.create as jest.Mock).mockResolvedValue(mockCategory());

      const result = await service.createCategory('u1', { name: 'Work' });

      expect(result.name).toBe('Work');
      expect(eventsService.publish).toHaveBeenCalled();
    });

    it('is idempotent when creating a duplicate category name for the same user', async () => {
      const existing = mockCategory();
      (prisma.vocabCategory.findFirst as jest.Mock).mockResolvedValue(existing);

      const result = await service.createCategory('u1', { name: 'Work' });

      expect(result).toBe(existing);
      expect(prisma.vocabCategory.create).not.toHaveBeenCalled();
    });

    it('unassigns words instead of deleting them when a category is deleted', async () => {
      (prisma.vocabCategory.findFirst as jest.Mock).mockResolvedValue(mockCategory());

      await service.deleteCategory('u1', 'cat1');

      expect(prisma.vocabWord.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', categoryId: 'cat1' },
        data: { categoryId: null },
      });
      expect(prisma.vocabCategory.delete).toHaveBeenCalledWith({ where: { id: 'cat1' } });
    });
  });

  // ─── Review sessions ─────────────────────────────────────────────────────

  describe('startReview', () => {
    it('returns an empty-state result instead of throwing when the notebook is empty', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.startReview('u1', {});

      expect(result).toEqual({ words: [], emptyReason: 'NO_VOCABULARY' });
    });

    it('returns fewer words than requested instead of erroring when the notebook is small', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([
        mockWord({ id: 'w1' }),
        mockWord({ id: 'w2' }),
      ]);

      const result = await service.startReview('u1', { count: 10 });

      expect(result.words).toHaveLength(2);
    });
  });

  describe('submitWordReview', () => {
    it('rejects reviewing a word that does not belong to the user', async () => {
      (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.submitWordReview('attacker', 'w1')).rejects.toThrow(NotFoundException);
    });

    it('creates progress on first review with status LEARNING', async () => {
      (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(mockWord());
      (prisma.vocabReviewProgress.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.vocabReviewProgress.upsert as jest.Mock).mockImplementation(({ create }) => ({
        ...create,
        id: 'p1',
      }));

      const result = await service.submitWordReview('u1', 'w1');

      expect(result.status).toBe(VocabularyStatus.LEARNING);
      expect(result.reviewCount).toBe(1);
    });

    it('does not mark a word LEARNED after a single review', async () => {
      (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(mockWord());
      (prisma.vocabReviewProgress.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.vocabReviewProgress.upsert as jest.Mock).mockImplementation(({ create }) => ({
        ...create,
        id: 'p1',
      }));

      const result = await service.submitWordReview('u1', 'w1');

      expect(result.status).not.toBe(VocabularyStatus.LEARNED);
    });
  });
});
