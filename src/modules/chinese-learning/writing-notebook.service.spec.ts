import { BadRequestException, ConflictException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WritingPageTemplate, WritingTraceMode } from '@prisma/client';
import { WritingNotebookService, parsePageCursor, parsePageLimit } from './writing-notebook.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { decodeStrokes, encodeStrokes } from './stroke-codec.js';
import { PAGE_LIST_MAX_LIMIT } from './writing-notebook.constants.js';

const grid = { columns: 5, rows: 6, marginRatio: 0.3, pinyinBandRatio: 0.5, rowGapRatio: 0.2 };

const mockPage = (overrides = {}) => ({
  id: 'p1',
  notebookId: 'n1',
  pageIndex: 0,
  templateType: WritingPageTemplate.BLANK,
  traceMode: null,
  gridConfig: grid,
  guides: null,
  strokeCount: 0,
  preview: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const stroke = (id: string, n = 5) => ({
  id,
  tool: 'pen',
  color: '#1c1b29',
  width: 0.006,
  startedAt: 1_700_000_000_000,
  points: Array.from({ length: n }, (_, i) => [0.1 + (i % 80) * 0.01, 0.2, i * 16, 0.5]),
});

describe('WritingNotebookService', () => {
  let service: WritingNotebookService;
  let prisma: {
    writingNotebook: Record<string, jest.Mock>;
    writingNotebookPage: Record<string, jest.Mock>;
  };
  let events: { publish: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingNotebookService,
        {
          provide: PrismaService,
          useValue: {
            writingNotebook: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              delete: jest.fn(),
            },
            writingNotebookPage: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
              groupBy: jest.fn(),
            },
          },
        },
        { provide: EventsService, useValue: { publish: jest.fn() } },
      ],
    }).compile();

    service = module.get(WritingNotebookService);
    prisma = module.get(PrismaService);
    events = module.get(EventsService);
  });

  // ─── Notebook CRUD ───────────────────────────────────────────────────────

  describe('notebooks', () => {
    it('lists only the caller’s notebooks with page counts', async () => {
      prisma.writingNotebook.findMany.mockResolvedValue([
        { id: 'n1', title: 'Vở HSK 1' },
        { id: 'n2', title: 'Vở HSK 2' },
      ]);
      prisma.writingNotebookPage.groupBy.mockResolvedValue([{ notebookId: 'n1', _count: { _all: 3 } }]);

      const result = await service.listNotebooks('u1');

      expect(prisma.writingNotebook.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
      expect(prisma.writingNotebookPage.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
      expect(result).toEqual([
        { id: 'n1', title: 'Vở HSK 1', pageCount: 3 },
        { id: 'n2', title: 'Vở HSK 2', pageCount: 0 },
      ]);
    });

    it('creates a notebook with a trimmed title and publishes an event', async () => {
      prisma.writingNotebook.create.mockResolvedValue({ id: 'n1', title: 'Vở HSK 1' });

      const result = await service.createNotebook('u1', { title: '  Vở HSK 1  ' });

      expect(prisma.writingNotebook.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userId: 'u1', title: 'Vở HSK 1' } }),
      );
      expect(result.pageCount).toBe(0);
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', eventType: EventType.WRITING_NOTEBOOK_CREATED }),
      );
    });

    it('rejects a whitespace-only title', async () => {
      await expect(service.createNotebook('u1', { title: '   ' })).rejects.toThrow(BadRequestException);
      expect(prisma.writingNotebook.create).not.toHaveBeenCalled();
    });

    it('renames an owned notebook', async () => {
      prisma.writingNotebook.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.writingNotebook.update.mockResolvedValue({ id: 'n1', title: 'Mới' });
      prisma.writingNotebookPage.count.mockResolvedValue(2);

      const result = await service.updateNotebook('u1', 'n1', { title: 'Mới' });

      expect(result).toEqual({ id: 'n1', title: 'Mới', pageCount: 2 });
      expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: EventType.WRITING_NOTEBOOK_UPDATED }));
    });

    it('deletes an owned notebook together with its pages', async () => {
      prisma.writingNotebook.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.writingNotebookPage.deleteMany.mockResolvedValue({ count: 4 });

      await service.deleteNotebook('u1', 'n1');

      expect(prisma.writingNotebookPage.deleteMany).toHaveBeenCalledWith({ where: { notebookId: 'n1', userId: 'u1' } });
      expect(prisma.writingNotebook.delete).toHaveBeenCalledWith({ where: { id: 'n1' } });
      expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: EventType.WRITING_NOTEBOOK_DELETED }));
    });
  });

  // ─── Ownership / IDOR ────────────────────────────────────────────────────

  describe('ownership (404 for missing-or-foreign records)', () => {
    beforeEach(() => {
      // Another user's notebook/page is simply invisible to a userId-scoped query.
      prisma.writingNotebook.findFirst.mockResolvedValue(null);
      prisma.writingNotebookPage.findFirst.mockResolvedValue(null);
      prisma.writingNotebookPage.updateMany.mockResolvedValue({ count: 0 });
    });

    it.each([
      ['rename notebook', () => service.updateNotebook('intruder', 'n1', { title: 'x' })],
      ['delete notebook', () => service.deleteNotebook('intruder', 'n1')],
      ['list pages', () => service.listPages('intruder', 'n1')],
      [
        'create page',
        () => service.createPage('intruder', 'n1', { templateType: WritingPageTemplate.BLANK, gridConfig: grid }),
      ],
      ['get page', () => service.getPage('intruder', 'n1', 'p1')],
      ['update page', () => service.updatePage('intruder', 'n1', 'p1', { version: 1, strokes: [] })],
      ['delete page', () => service.deletePage('intruder', 'n1', 'p1')],
    ])('%s → 404', async (_label, call) => {
      await expect(call()).rejects.toThrow(NotFoundException);
      expect(prisma.writingNotebook.update).not.toHaveBeenCalled();
      expect(prisma.writingNotebook.delete).not.toHaveBeenCalled();
      expect(prisma.writingNotebookPage.delete).not.toHaveBeenCalled();
      expect(prisma.writingNotebookPage.deleteMany).not.toHaveBeenCalled();
      expect(prisma.writingNotebookPage.create).not.toHaveBeenCalled();
    });

    it('scopes every page lookup by userId', async () => {
      await expect(service.getPage('intruder', 'n1', 'p1')).rejects.toThrow(NotFoundException);
      expect(prisma.writingNotebookPage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1', notebookId: 'n1', userId: 'intruder' } }),
      );
    });
  });

  // ─── Page create ─────────────────────────────────────────────────────────

  describe('createPage', () => {
    beforeEach(() => {
      prisma.writingNotebook.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.writingNotebook.update.mockResolvedValue({ nextPageIndex: 8 });
      prisma.writingNotebookPage.create.mockImplementation(({ data }) => Promise.resolve(mockPage({ ...data, id: 'p9' })));
      prisma.writingNotebookPage.findFirst.mockResolvedValue(null);
    });

    it('allocates pageIndex atomically from the notebook counter', async () => {
      prisma.writingNotebookPage.count.mockResolvedValueOnce(7).mockResolvedValueOnce(8);

      const page = await service.createPage('u1', 'n1', { templateType: WritingPageTemplate.BLANK, gridConfig: grid });

      expect(prisma.writingNotebook.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'n1' }, data: { nextPageIndex: { increment: 1 } } }),
      );
      expect(prisma.writingNotebookPage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pageIndex: 7, userId: 'u1', version: 1 }) }),
      );
      expect(page).toEqual(expect.objectContaining({ id: 'p9', strokes: [], position: 8, totalPages: 8 }));
      expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: EventType.WRITING_PAGE_CREATED }));
    });

    it('stores guides and defaults traceMode for a GUIDED page', async () => {
      await service.createPage('u1', 'n1', {
        templateType: WritingPageTemplate.GUIDED,
        gridConfig: grid,
        guides: [{ row: 0, character: '学', pinyin: ' xué ' }],
      });
      expect(prisma.writingNotebookPage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            traceMode: WritingTraceMode.FIRST_ONLY,
            guides: [{ row: 0, character: '学', pinyin: 'xué' }],
          }),
        }),
      );
    });

    it.each([
      ['GUIDED without guides', { templateType: WritingPageTemplate.GUIDED, gridConfig: grid }],
      [
        'BLANK with guides',
        { templateType: WritingPageTemplate.BLANK, gridConfig: grid, guides: [{ row: 0, character: '学' }] },
      ],
      [
        'guide row outside the grid',
        { templateType: WritingPageTemplate.GUIDED, gridConfig: grid, guides: [{ row: 6, character: '学' }] },
      ],
      [
        'two guides on one row',
        {
          templateType: WritingPageTemplate.GUIDED,
          gridConfig: grid,
          guides: [
            { row: 1, character: '学' },
            { row: 1, character: '习' },
          ],
        },
      ],
    ])('rejects %s', async (_label, dto) => {
      await expect(service.createPage('u1', 'n1', dto)).rejects.toThrow(BadRequestException);
      expect(prisma.writingNotebookPage.create).not.toHaveBeenCalled();
    });
  });

  // ─── Pagination ──────────────────────────────────────────────────────────

  describe('listPages pagination', () => {
    beforeEach(() => {
      prisma.writingNotebook.findFirst.mockResolvedValue({ id: 'n1' });
    });

    it('returns the first page and a cursor when more remain, never selecting stroke data', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => mockPage({ id: `p${i}`, pageIndex: i * 2 }));
      prisma.writingNotebookPage.findMany.mockResolvedValue(rows);
      prisma.writingNotebookPage.count.mockResolvedValue(10);

      const result = await service.listPages('u1', 'n1', undefined, '2');

      const args = prisma.writingNotebookPage.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ notebookId: 'n1', userId: 'u1' });
      expect(args.take).toBe(3);
      expect(args.orderBy).toEqual({ pageIndex: 'asc' });
      expect(args.select.strokesData).toBeUndefined();
      expect(result.items.map((p) => p.id)).toEqual(['p0', 'p1']);
      expect(result.items.map((p) => p.position)).toEqual([1, 2]);
      expect(result.nextCursor).toBe('2');
      expect(result.total).toBe(10);
    });

    it('continues after the cursor with dense positions and ends with a null cursor', async () => {
      prisma.writingNotebookPage.findMany.mockResolvedValue([mockPage({ id: 'p5', pageIndex: 9 })]);
      // total, then "pages up to and including the cursor"
      prisma.writingNotebookPage.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);

      const result = await service.listPages('u1', 'n1', '4', '2');

      expect(prisma.writingNotebookPage.findMany.mock.calls[0][0].where).toEqual({
        notebookId: 'n1',
        userId: 'u1',
        pageIndex: { gt: 4 },
      });
      expect(result.items[0].position).toBe(3);
      expect(result.nextCursor).toBeNull();
    });

    it('validates cursor and limit', () => {
      expect(parsePageCursor(undefined)).toBeUndefined();
      expect(parsePageCursor('12')).toBe(12);
      expect(() => parsePageCursor('-1')).toThrow(BadRequestException);
      expect(() => parsePageCursor('abc')).toThrow(BadRequestException);
      expect(parsePageLimit(undefined)).toBe(20);
      expect(parsePageLimit('500')).toBe(PAGE_LIST_MAX_LIMIT);
      expect(() => parsePageLimit('0')).toThrow(BadRequestException);
      expect(() => parsePageLimit('2.5')).toThrow(BadRequestException);
    });
  });

  // ─── Page read / update / delete ────────────────────────────────────────

  describe('getPage', () => {
    it('decodes stored strokes and includes neighbour navigation', async () => {
      const strokes = [stroke('s1')];
      prisma.writingNotebookPage.findFirst
        .mockResolvedValueOnce({ ...mockPage({ pageIndex: 3 }), strokesData: await encodeStrokes(JSON.stringify(strokes)) })
        .mockResolvedValueOnce({ id: 'prev' })
        .mockResolvedValueOnce(null);
      prisma.writingNotebookPage.count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);

      const page = await service.getPage('u1', 'n1', 'p1');

      expect(page.strokes).toEqual(strokes);
      expect(page).not.toHaveProperty('strokesData');
      expect(page).toEqual(
        expect.objectContaining({ position: 3, totalPages: 3, prevPageId: 'prev', nextPageId: null }),
      );
    });
  });

  describe('updatePage', () => {
    it('saves compressed canonical strokes with an atomic version check and bumps the version', async () => {
      prisma.writingNotebookPage.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.updatePage('u1', 'n1', 'p1', { version: 4, strokes: [stroke('s1'), stroke('s2')] });

      const args = prisma.writingNotebookPage.updateMany.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'p1', notebookId: 'n1', userId: 'u1', version: 4 });
      expect(args.data.version).toEqual({ increment: 1 });
      expect(args.data.strokeCount).toBe(2);
      const stored = await decodeStrokes(args.data.strokesData);
      expect(stored.map((s) => s.id)).toEqual(['s1', 's2']);
      expect(stored[0].color).toBe('#1C1B29');
      expect(args.data.preview.strokes).toHaveLength(2);
      expect(result).toEqual(expect.objectContaining({ id: 'p1', version: 5, strokeCount: 2 }));
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.WRITING_PAGE_UPDATED, payload: expect.objectContaining({ version: 5 }) }),
      );
    });

    it('returns 409 when the version is stale', async () => {
      prisma.writingNotebookPage.updateMany.mockResolvedValue({ count: 0 });
      prisma.writingNotebookPage.findFirst.mockResolvedValue({ version: 7 });

      await expect(service.updatePage('u1', 'n1', 'p1', { version: 4, strokes: [stroke('s1')] })).rejects.toThrow(
        ConflictException,
      );
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('rejects malformed strokes before touching the database', async () => {
      await expect(
        service.updatePage('u1', 'n1', 'p1', { version: 1, strokes: [{ ...stroke('s1'), points: [[0.1, 0.1]] }] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.writingNotebookPage.updateMany).not.toHaveBeenCalled();
    });

    it('rejects an oversized page with 413', async () => {
      const many = Array.from({ length: 81 }, (_, i) => stroke(`s${i}`, 5000));
      await expect(service.updatePage('u1', 'n1', 'p1', { version: 1, strokes: many })).rejects.toThrow(
        PayloadTooLargeException,
      );
      expect(prisma.writingNotebookPage.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('deletePage', () => {
    it('deletes an owned page and publishes an event', async () => {
      prisma.writingNotebookPage.findFirst.mockResolvedValue({ id: 'p1', pageIndex: 2 });

      await service.deletePage('u1', 'n1', 'p1');

      expect(prisma.writingNotebookPage.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
      expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: EventType.WRITING_PAGE_DELETED }));
    });
  });
});
