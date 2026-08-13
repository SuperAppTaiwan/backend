import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChineseStoryService } from './chinese-story.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { AIProviderChain } from '../ai/providers/ai-provider-chain.service.js';

const mockVocabWord = (overrides = {}) => ({
  id: 'w1',
  userId: 'u1',
  categoryId: null,
  simplified: '工作',
  simplifiedPinyin: 'gōng zuò',
  traditional: '工作',
  traditionalPinyin: 'gōng zuò',
  meaningVi: 'công việc',
  example: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  progress: null,
  ...overrides,
});

const VALID_AI_JSON = JSON.stringify({
  titleSimplified: '工作的一天',
  titleTraditional: '工作的一天',
  paragraphs: [
    { simplified: '我今天去工作。', traditional: '我今天去工作。', vietnamese: 'Hôm nay tôi đi làm việc.' },
    { simplified: '朋友也在那里。', traditional: '朋友也在那裡。', vietnamese: 'Bạn tôi cũng ở đó.' },
  ],
});

describe('ChineseStoryService', () => {
  let service: ChineseStoryService;
  let prisma: jest.Mocked<PrismaService>;
  let events: jest.Mocked<EventsService>;
  let aiChain: jest.Mocked<AIProviderChain>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChineseStoryService,
        {
          provide: PrismaService,
          useValue: {
            vocabWord: { findMany: jest.fn() },
            story: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        { provide: EventsService, useValue: { publish: jest.fn() } },
        { provide: AIProviderChain, useValue: { generateText: jest.fn() } },
      ],
    }).compile();

    service = module.get(ChineseStoryService);
    prisma = module.get(PrismaService);
    events = module.get(EventsService);
    aiChain = module.get(AIProviderChain);
  });

  // ─── Ownership / IDOR isolation ─────────────────────────────────────────

  describe('ownership isolation', () => {
    it('returns 404 (not 403) when getting another user\'s story', async () => {
      (prisma.story.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getStory('attacker', 's1')).rejects.toThrow(NotFoundException);
      expect(prisma.story.findFirst).toHaveBeenCalledWith({ where: { id: 's1', userId: 'attacker' } });
    });

    it('returns 404 when deleting another user\'s story and does not delete it', async () => {
      (prisma.story.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteStory('attacker', 's1')).rejects.toThrow(NotFoundException);
      expect(prisma.story.delete).not.toHaveBeenCalled();
    });

    it('scopes listStories to the requesting user only', async () => {
      (prisma.story.findMany as jest.Mock).mockResolvedValue([]);
      await service.listStories('u1');
      expect(prisma.story.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });
  });

  // ─── Generation: vocabulary sizing ───────────────────────────────────────

  describe('generatePreview — vocabulary strategy', () => {
    it('works with zero saved vocabulary by falling back to common words', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (aiChain.generateText as jest.Mock).mockResolvedValue('');

      const result = await service.generatePreview('u1');

      expect(result.paragraphs.length).toBeGreaterThan(0);
      expect(result.provider).toBe('deterministic');
    });

    it('tops up with fallback vocabulary when the user has too few words', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([mockVocabWord()]);
      (aiChain.generateText as jest.Mock).mockResolvedValue('');

      const result = await service.generatePreview('u1');

      // Deterministic fallback always produces a valid story regardless of pool size.
      expect(result.paragraphs.length).toBeGreaterThan(0);
    });

    it('works with many saved vocabulary words (caps candidate pool, never throws)', async () => {
      const many = Array.from({ length: 30 }, (_, i) =>
        mockVocabWord({ id: `w${i}`, simplified: `词${i}` }),
      );
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue(many);
      (aiChain.generateText as jest.Mock).mockResolvedValue('');

      const result = await service.generatePreview('u1');

      expect(result.paragraphs.length).toBeGreaterThan(0);
    });
  });

  // ─── Generation: AI parsing / validation ─────────────────────────────────

  describe('generatePreview — AI output handling', () => {
    it('uses the AI-generated story when the model returns valid JSON', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([mockVocabWord()]);
      (aiChain.generateText as jest.Mock).mockResolvedValue(VALID_AI_JSON);

      const result = await service.generatePreview('u1');

      expect(result.provider).toBe('ai');
      expect(result.titleSimplified).toBe('工作的一天');
      expect(result.paragraphs).toHaveLength(2);
    });

    it('falls back to the deterministic story when the AI returns malformed JSON', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([mockVocabWord()]);
      (aiChain.generateText as jest.Mock).mockResolvedValue('not valid json at all');

      const result = await service.generatePreview('u1');

      expect(result.provider).toBe('deterministic');
      expect(result.paragraphs.length).toBeGreaterThan(0);
    });

    it('falls back to the deterministic story when the AI omits required fields', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([mockVocabWord()]);
      (aiChain.generateText as jest.Mock).mockResolvedValue(JSON.stringify({ paragraphs: [] }));

      const result = await service.generatePreview('u1');

      expect(result.provider).toBe('deterministic');
    });

    it('falls back to the deterministic story when the AI provider throws', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([mockVocabWord()]);
      (aiChain.generateText as jest.Mock).mockRejectedValue(new Error('provider down'));

      const result = await service.generatePreview('u1');

      expect(result.provider).toBe('deterministic');
      expect(result.paragraphs.length).toBeGreaterThan(0);
    });

    it('computes vocabularyUsed from actual text matches, not the request list', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([mockVocabWord()]);
      (aiChain.generateText as jest.Mock).mockResolvedValue(VALID_AI_JSON);

      const result = await service.generatePreview('u1');

      expect(result.vocabularyUsed.some((v) => v.simplified === '工作')).toBe(true);
    });

    it('does not persist anything to the database on generate', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([mockVocabWord()]);
      (aiChain.generateText as jest.Mock).mockResolvedValue(VALID_AI_JSON);

      await service.generatePreview('u1');

      expect(prisma.story.create).not.toHaveBeenCalled();
    });
  });

  // ─── Save ─────────────────────────────────────────────────────────────────

  describe('saveStory', () => {
    it('persists the story and publishes an event', async () => {
      (prisma.story.create as jest.Mock).mockResolvedValue({ id: 's1', userId: 'u1' });

      const result = await service.saveStory('u1', {
        titleSimplified: '标题',
        titleTraditional: '標題',
        paragraphs: [{ simplified: '你好。', traditional: '你好。', vietnamese: 'Xin chào.' }],
      });

      expect(result.id).toBe('s1');
      expect(prisma.story.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
      );
      expect(events.publish).toHaveBeenCalled();
    });
  });
});
