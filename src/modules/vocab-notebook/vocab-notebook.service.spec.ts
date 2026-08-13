import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReviewResult, VocabularyStatus } from '@prisma/client';
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
              createMany: jest.fn(),
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

    // Regression: MinLength(1) alone accepts a whitespace-only DTO name (e.g.
    // "   ", length 3) since it validates the raw string before the service
    // trims it — reproduced live against the real backend (HTTP 201, name:
    // ""). This is the service-layer half of that fix; the DTO's
    // @Matches(/\S/) is the other half (see category.dto.ts / its own spec).
    it('rejects creating a category whose name is only whitespace, even if it slipped past DTO validation', async () => {
      await expect(service.createCategory('u1', { name: '   ' })).rejects.toThrow(BadRequestException);
      expect(prisma.vocabCategory.create).not.toHaveBeenCalled();
    });

    it('rejects renaming a category to a whitespace-only name', async () => {
      (prisma.vocabCategory.findFirst as jest.Mock).mockResolvedValue(mockCategory());

      await expect(service.updateCategory('u1', 'cat1', { name: '   ' })).rejects.toThrow(BadRequestException);
      expect(prisma.vocabCategory.update).not.toHaveBeenCalled();
    });

    it('allows updateCategory to touch other fields without requiring name', async () => {
      (prisma.vocabCategory.findFirst as jest.Mock).mockResolvedValue(mockCategory());
      (prisma.vocabCategory.update as jest.Mock).mockResolvedValue(mockCategory());

      await expect(service.updateCategory('u1', 'cat1', {})).resolves.toBeDefined();
      expect(prisma.vocabCategory.update).toHaveBeenCalledWith({ where: { id: 'cat1' }, data: {} });
    });
  });

  // ─── Traditional fallback normalization (single-word create/update) ────────
  // Same normalizeTraditionalFields() used by bulkCreateWords — see its own
  // spec file for the pure-function cases; these confirm the service actually
  // wires it in for both create and update.

  describe('createWord — Traditional fallback', () => {
    it('falls back Traditional/TraditionalPinyin to Simplified when left blank, honoring the Add Vocabulary form\'s own hint text', async () => {
      (prisma.vocabWord.create as jest.Mock).mockImplementation(({ data }) => ({ ...data, id: 'w1' }));

      const result = await service.createWord('u1', {
        simplified: '电影', simplifiedPinyin: 'diànyǐng', meaningVi: 'phim',
      });

      expect(result.traditional).toBe('电影');
      expect(result.traditionalPinyin).toBe('diànyǐng');
    });

    it('preserves an explicitly different Traditional value', async () => {
      (prisma.vocabWord.create as jest.Mock).mockImplementation(({ data }) => ({ ...data, id: 'w1' }));

      const result = await service.createWord('u1', {
        simplified: '爱', simplifiedPinyin: 'ài', meaningVi: 'yêu', traditional: '愛', traditionalPinyin: 'ài',
      });

      expect(result.traditional).toBe('愛');
    });

    it('persists example pinyin and Vietnamese example translation', async () => {
      (prisma.vocabWord.create as jest.Mock).mockImplementation(({ data }) => ({ ...data, id: 'w1' }));

      const result = await service.createWord('u1', {
        simplified: '电影', simplifiedPinyin: 'diànyǐng', meaningVi: 'phim',
        example: '我喜欢看电影。', examplePinyin: 'Wǒ xǐhuān kàn diànyǐng.', exampleVietnamese: 'Tôi thích xem phim.',
      });

      expect(result.examplePinyin).toBe('Wǒ xǐhuān kàn diànyǐng.');
      expect(result.exampleVietnamese).toBe('Tôi thích xem phim.');
    });
  });

  describe('updateWord — Traditional fallback', () => {
    it('falls back to Simplified when Traditional is cleared to blank in an edit', async () => {
      (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(
        mockWord({ simplified: '电影', simplifiedPinyin: 'diànyǐng', traditional: '電影', traditionalPinyin: 'diànyǐng' }),
      );
      (prisma.vocabWord.update as jest.Mock).mockImplementation(({ data }) => data);

      const result = await service.updateWord('u1', 'w1', { traditional: '', traditionalPinyin: '' });

      expect(result.traditional).toBe('电影');
      expect(result.traditionalPinyin).toBe('diànyǐng');
    });

    it('does not touch Traditional when the edit does not mention it', async () => {
      (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(
        mockWord({ simplified: '爱', traditional: '愛' }),
      );
      (prisma.vocabWord.update as jest.Mock).mockImplementation(({ data }) => data);

      const result = await service.updateWord('u1', 'w1', { meaningVi: 'yêu (updated)' });

      expect(result).not.toHaveProperty('traditional');
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

    it('mints a fresh sessionId for every call, so the previous session can later be identified', async () => {
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([mockWord({ id: 'w1' })]);

      const first = await service.startReview('u1', {});
      const second = await service.startReview('u1', {});

      expect(typeof first.sessionId).toBe('string');
      expect(first.sessionId).not.toBe(second.sessionId);
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

    it('persists the sessionId onto progress, for the next startReview to deprioritize', async () => {
      (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(mockWord());
      (prisma.vocabReviewProgress.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.vocabReviewProgress.upsert as jest.Mock).mockImplementation(({ create }) => ({
        ...create,
        id: 'p1',
      }));

      await service.submitWordReview('u1', 'w1', 'session-abc');

      expect(prisma.vocabReviewProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ lastReviewSessionId: 'session-abc' }),
          update: expect.objectContaining({ lastReviewSessionId: 'session-abc' }),
        }),
      );
    });

    // Quick Review's flip-card rating path — same VocabReviewProgress row as the
    // handwriting-trace flow above, but driven by AGAIN/HARD/GOOD/EASY instead of
    // a plain reviewCount ladder (see review-progress.ts).
    describe('with a difficulty result (Quick Review)', () => {
      it('marks the word LEARNED immediately on an EASY result', async () => {
        (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(mockWord());
        (prisma.vocabReviewProgress.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.vocabReviewProgress.upsert as jest.Mock).mockImplementation(({ create }) => ({
          ...create,
          id: 'p1',
        }));

        const result = await service.submitWordReview('u1', 'w1', undefined, ReviewResult.EASY);

        expect(result.status).toBe(VocabularyStatus.LEARNED);
      });

      it('keeps status LEARNING and does not lower familiarity below 0 on AGAIN', async () => {
        (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(mockWord());
        (prisma.vocabReviewProgress.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.vocabReviewProgress.upsert as jest.Mock).mockImplementation(({ create }) => ({
          ...create,
          id: 'p1',
        }));

        const result = await service.submitWordReview('u1', 'w1', undefined, ReviewResult.AGAIN);

        expect(result.status).toBe(VocabularyStatus.LEARNING);
        expect(result.familiarity).toBe(0);
      });

      it('sets (not increments) familiarity from the result-based curve, unlike the no-result path', async () => {
        (prisma.vocabWord.findFirst as jest.Mock).mockResolvedValue(mockWord());
        (prisma.vocabReviewProgress.findUnique as jest.Mock).mockResolvedValue({
          familiarity: 5,
          reviewCount: 3,
          lastReviewSessionId: null,
        });
        (prisma.vocabReviewProgress.upsert as jest.Mock).mockImplementation(({ update }) => update);

        await service.submitWordReview('u1', 'w1', undefined, ReviewResult.GOOD);

        expect(prisma.vocabReviewProgress.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({ status: VocabularyStatus.REVIEW, familiarity: { set: 5 } }),
          }),
        );
      });
    });
  });

  // ─── Bulk import ─────────────────────────────────────────────────────────
  // Auth itself (rejecting unauthenticated requests) is enforced by the
  // controller's class-level @UseGuards(JwtAuthGuard), the same as every
  // other route here — not something the service layer ever sees, so it's
  // not re-tested at this layer (consistent with the rest of this file).
  describe('bulkCreateWords', () => {
    it('creates multiple valid rows in one batched insert', async () => {
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 2 });

      const result = await service.bulkCreateWords('u1', [
        { simplified: '爱', simplifiedPinyin: 'ài', meaningVi: 'yêu' },
        { simplified: '八', simplifiedPinyin: 'bā', meaningVi: 'tám' },
      ]);

      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
      expect(prisma.vocabWord.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 'u1', simplified: '爱' }),
          expect.objectContaining({ userId: 'u1', simplified: '八' }),
        ]),
      });
    });

    it('reports per-row validation failures with a reason instead of rejecting the whole batch', async () => {
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.bulkCreateWords('u1', [
        { simplified: '爱', simplifiedPinyin: 'ài', meaningVi: 'yêu' },
        { simplified: '', simplifiedPinyin: 'bā', meaningVi: 'tám' },
        { simplified: '爸爸', simplifiedPinyin: 'bàba', meaningVi: '' },
      ]);

      expect(result.created).toBe(1);
      expect(result.failed).toBe(2);
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ index: 1, status: 'failed', reason: 'Thiếu chữ giản thể' }),
          expect.objectContaining({ index: 2, status: 'failed', reason: 'Thiếu nghĩa tiếng Việt' }),
        ]),
      );
    });

    it('skips a row whose simplified word already exists for this user, without failing the batch', async () => {
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([{ simplified: '爱' }]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.bulkCreateWords('u1', [
        { simplified: '爱', simplifiedPinyin: 'ài', meaningVi: 'yêu' },
        { simplified: '八', simplifiedPinyin: 'bā', meaningVi: 'tám' },
      ]);

      expect(result.skipped).toBe(1);
      expect(result.created).toBe(1);
      expect(prisma.vocabWord.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ simplified: '八' })],
      });
    });

    it('skips duplicate rows within the same pasted batch (not just against existing DB rows)', async () => {
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.bulkCreateWords('u1', [
        { simplified: '爱', simplifiedPinyin: 'ài', meaningVi: 'yêu' },
        { simplified: '爱', simplifiedPinyin: 'ài', meaningVi: 'yêu (dup)' },
      ]);

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('rejects a row whose categoryId belongs to another user (IDOR) instead of assigning it', async () => {
      // findMany scoped to { id: in, userId } returns nothing for a category
      // owned by someone else — exactly what a real Prisma query would do.
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await service.bulkCreateWords('attacker', [
        { simplified: '爱', simplifiedPinyin: 'ài', meaningVi: 'yêu', categoryId: 'victims-category' },
      ]);

      expect(result.created).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0]).toEqual(
        expect.objectContaining({ status: 'failed', reason: 'Danh mục không hợp lệ' }),
      );
      expect(prisma.vocabWord.createMany).not.toHaveBeenCalled();
    });

    it('accepts a categoryId that the user genuinely owns', async () => {
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([{ id: 'cat1' }]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await service.bulkCreateWords('u1', [
        { simplified: '爱', simplifiedPinyin: 'ài', meaningVi: 'yêu', categoryId: 'cat1' },
      ]);

      expect(result.created).toBe(1);
      expect(prisma.vocabWord.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ categoryId: 'cat1' })],
      });
    });

    it('never trusts a client-supplied userId — every created row is scoped to the authenticated user', async () => {
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.bulkCreateWords('u1', [
        // @ts-expect-error — deliberately simulating a tampered payload that tries to inject a foreign userId
        { simplified: '爱', simplifiedPinyin: 'ài', meaningVi: 'yêu', userId: 'someone-else' },
      ]);

      expect(prisma.vocabWord.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ userId: 'u1' })],
      });
    });

    it('falls back Traditional/TraditionalPinyin to Simplified when a row omits them (identical-form words, e.g. 电影)', async () => {
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.bulkCreateWords('u1', [
        { simplified: '电影', simplifiedPinyin: 'diànyǐng', meaningVi: 'phim' },
      ]);

      expect(prisma.vocabWord.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ traditional: '电影', traditionalPinyin: 'diànyǐng' })],
      });
    });

    it('preserves an explicitly different Traditional value supplied in a bulk row', async () => {
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.bulkCreateWords('u1', [
        { simplified: '车', simplifiedPinyin: 'chē', traditional: '車', traditionalPinyin: 'chē', meaningVi: 'xe' },
      ]);

      expect(prisma.vocabWord.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ traditional: '車', traditionalPinyin: 'chē' })],
      });
    });

    it('persists example pinyin and Vietnamese example translation for a bulk row', async () => {
      (prisma.vocabCategory.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.vocabWord.createMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.bulkCreateWords('u1', [
        {
          simplified: '电影', simplifiedPinyin: 'diànyǐng', meaningVi: 'phim',
          example: '我喜欢看电影。', examplePinyin: 'Wǒ xǐhuān kàn diànyǐng.', exampleVietnamese: 'Tôi thích xem phim.',
        },
      ]);

      expect(prisma.vocabWord.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({
          examplePinyin: 'Wǒ xǐhuān kàn diànyǐng.',
          exampleVietnamese: 'Tôi thích xem phim.',
        })],
      });
    });
  });
});
