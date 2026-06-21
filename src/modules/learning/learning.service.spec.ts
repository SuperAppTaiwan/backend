import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LearningService } from './learning.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';

const mockVocab = (overrides = {}) => ({
  id: 'v1',
  traditional: '你好', simplified: '你好', pinyin: 'nǐ hǎo',
  meaningVi: 'Xin chào', meaningEn: null,
  exampleTraditional: null, exampleSimplified: null,
  examplePinyin: null, exampleMeaningVi: null,
  hskLevel: 1, topic: 'greeting', source: 'system',
  createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const mockProgress = (overrides = {}) => ({
  id: 'pr1', userId: 'u1', vocabularyId: 'v1',
  status: 'LEARNING', familiarity: 2, reviewCount: 3,
  lastReviewedAt: new Date(), nextReviewAt: new Date(),
  learnedAt: null, createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const mockPlan = (overrides = {}) => ({
  id: 'pl1', userId: 'u1', title: 'Test Plan', targetLevel: 'HSK2',
  dailyWordTarget: 5, startDate: new Date(), endDate: null,
  status: 'ACTIVE', metadataJson: null, createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

describe('LearningService', () => {
  let service: LearningService;
  let prisma: jest.Mocked<PrismaService>;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearningService,
        {
          provide: PrismaService,
          useValue: {
            vocabulary: {
              count: jest.fn(),
              createMany: jest.fn(),
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            userVocabularyProgress: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              upsert: jest.fn(),
              count: jest.fn(),
            },
            learningPlan: {
              create: jest.fn(),
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            reviewSession: {
              create: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: EventsService,
          useValue: { publish: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(LearningService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    eventsService = module.get(EventsService) as jest.Mocked<EventsService>;
  });

  describe('createVocabulary', () => {
    it('creates vocabulary and publishes VOCABULARY_CREATED event', async () => {
      const vocab = mockVocab({ source: 'user' });
      (prisma.vocabulary.create as jest.Mock).mockResolvedValue(vocab);

      const result = await service.createVocabulary('u1', {
        traditional: '你好', simplified: '你好', pinyin: 'nǐ hǎo', meaningVi: 'Xin chào',
      });

      expect(result.id).toBe('v1');
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.VOCABULARY_CREATED }),
      );
    });
  });

  describe('findVocabularyById', () => {
    it('returns vocabulary when found', async () => {
      (prisma.vocabulary.findUnique as jest.Mock).mockResolvedValue(mockVocab());
      const result = await service.findVocabularyById('v1');
      expect(result.id).toBe('v1');
    });

    it('throws NotFoundException when not found', async () => {
      (prisma.vocabulary.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.findVocabularyById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateVocabulary', () => {
    it('throws ForbiddenException for system vocabulary', async () => {
      (prisma.vocabulary.findUnique as jest.Mock).mockResolvedValue(mockVocab({ source: 'system' }));
      await expect(service.updateVocabulary('u1', 'v1', { meaningVi: 'Xin chào' })).rejects.toThrow(ForbiddenException);
    });

    it('updates user vocabulary', async () => {
      const updated = mockVocab({ source: 'user', meaningVi: 'Updated' });
      (prisma.vocabulary.findUnique as jest.Mock).mockResolvedValue(mockVocab({ source: 'user' }));
      (prisma.vocabulary.update as jest.Mock).mockResolvedValue(updated);
      const result = await service.updateVocabulary('u1', 'v1', { meaningVi: 'Updated' });
      expect(result.meaningVi).toBe('Updated');
    });
  });

  describe('markLearned', () => {
    it('upserts progress and publishes VOCABULARY_LEARNED event', async () => {
      (prisma.vocabulary.findUnique as jest.Mock).mockResolvedValue(mockVocab());
      (prisma.userVocabularyProgress.upsert as jest.Mock).mockResolvedValue(mockProgress({ status: 'LEARNED' }));

      const result = await service.markLearned('u1', 'v1');

      expect(result.status).toBe('LEARNED');
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.VOCABULARY_LEARNED }),
      );
    });

    it('throws NotFoundException for unknown vocabulary', async () => {
      (prisma.vocabulary.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.markLearned('u1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('submitReview', () => {
    it('updates progress with correct nextReviewAt for GOOD result', async () => {
      (prisma.vocabulary.findUnique as jest.Mock).mockResolvedValue(mockVocab());
      (prisma.userVocabularyProgress.findUnique as jest.Mock).mockResolvedValue(mockProgress({ familiarity: 2 }));
      const upserted = mockProgress({ status: 'REVIEW', reviewCount: 4 });
      (prisma.userVocabularyProgress.upsert as jest.Mock).mockResolvedValue(upserted);
      (prisma.reviewSession.create as jest.Mock).mockResolvedValue({});

      const result = await service.submitReview('u1', { vocabularyId: 'v1', result: 'GOOD' });

      expect(result.reviewCount).toBe(4);
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.VOCABULARY_REVIEWED }),
      );
    });

    it('sets status LEARNED for EASY result', async () => {
      (prisma.vocabulary.findUnique as jest.Mock).mockResolvedValue(mockVocab());
      (prisma.userVocabularyProgress.findUnique as jest.Mock).mockResolvedValue(mockProgress());
      (prisma.userVocabularyProgress.upsert as jest.Mock).mockImplementation(({ create }) => Promise.resolve(create));
      (prisma.reviewSession.create as jest.Mock).mockResolvedValue({});

      await service.submitReview('u1', { vocabularyId: 'v1', result: 'EASY' });

      const upsertCall = (prisma.userVocabularyProgress.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertCall.create.status).toBe('LEARNED');
    });

    it('sets status LEARNING for AGAIN result', async () => {
      (prisma.vocabulary.findUnique as jest.Mock).mockResolvedValue(mockVocab());
      (prisma.userVocabularyProgress.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.userVocabularyProgress.upsert as jest.Mock).mockImplementation(({ create }) => Promise.resolve(create));
      (prisma.reviewSession.create as jest.Mock).mockResolvedValue({});

      await service.submitReview('u1', { vocabularyId: 'v1', result: 'AGAIN' });

      const upsertCall = (prisma.userVocabularyProgress.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertCall.create.status).toBe('LEARNING');
    });
  });

  describe('getProgress', () => {
    it('returns progress summary', async () => {
      (prisma.vocabulary.count as jest.Mock).mockResolvedValue(10);
      (prisma.userVocabularyProgress.findMany as jest.Mock).mockResolvedValue([
        { status: 'LEARNED', lastReviewedAt: new Date() },
        { status: 'LEARNING', lastReviewedAt: null },
      ]);
      (prisma.userVocabularyProgress.count as jest.Mock).mockResolvedValue(1);

      const result = await service.getProgress('u1');

      expect(result.totalWords).toBe(10);
      expect(result.learnedWords).toBe(1);
      expect(result.reviewDueCount).toBe(1);
      expect(result.wordsByStatus.NEW).toBe(8);
    });
  });

  describe('createPlan', () => {
    it('creates plan and publishes LEARNING_PLAN_CREATED event', async () => {
      const plan = mockPlan();
      (prisma.learningPlan.create as jest.Mock).mockResolvedValue(plan);

      const result = await service.createPlan('u1', {
        title: 'Test Plan', startDate: '2026-07-01',
      });

      expect(result.id).toBe('pl1');
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.LEARNING_PLAN_CREATED }),
      );
    });
  });

  describe('createHskPlan', () => {
    it('creates HSK plan with correct word count and publishes HSK_GOAL_CREATED event', async () => {
      const plan = mockPlan({ title: 'HSK 2 — 150 từ trong 30 ngày' });
      (prisma.learningPlan.create as jest.Mock).mockResolvedValue(plan);

      const result = await service.createHskPlan('u1', {
        targetLevel: 2, targetDate: new Date(Date.now() + 30 * 86400_000).toISOString().split('T')[0],
      });

      expect(result.summary.wordsNeeded).toBe(150);
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.HSK_GOAL_CREATED }),
      );
    });
  });

  describe('getWeeklyReport', () => {
    it('returns weekly summary with activeDays and review counts', async () => {
      const recentDate = new Date();
      (prisma.reviewSession.findMany as jest.Mock).mockResolvedValue([
        { result: 'GOOD', reviewedAt: recentDate },
        { result: 'GOOD', reviewedAt: recentDate },
        { result: 'AGAIN', reviewedAt: recentDate },
      ]);
      (prisma.userVocabularyProgress.findMany as jest.Mock).mockResolvedValue([
        { learnedAt: recentDate },
      ]);

      const result = await service.getWeeklyReport('u1');

      expect(result.totalReviews).toBe(3);
      expect(result.newWordsLearned).toBe(1);
      expect(result.activeDays).toBe(1);
      expect(result.resultBreakdown['GOOD']).toBe(2);
    });
  });
});
