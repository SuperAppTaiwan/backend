import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WritingPageTemplate, WritingTraceMode } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import {
  CreateWritingNotebookDto,
  CreateWritingPageDto,
  UpdateWritingNotebookDto,
  UpdateWritingPageDto,
} from './dto/writing-notebook.dto.js';
import { canonicalizeStrokes, serializeStrokes } from './stroke-validation.js';
import { decodeStrokes, encodeStrokes } from './stroke-codec.js';
import { buildPagePreview } from './stroke-preview.js';
import { PAGE_LIST_DEFAULT_LIMIT, PAGE_LIST_MAX_LIMIT } from './writing-notebook.constants.js';

const SOURCE_MODULE = 'chinese-learning';

// Everything on a page row EXCEPT the (potentially multi-MB) stroke blob.
const PAGE_SUMMARY_SELECT = {
  id: true,
  notebookId: true,
  pageIndex: true,
  templateType: true,
  traceMode: true,
  gridConfig: true,
  guides: true,
  strokeCount: true,
  preview: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WritingNotebookPageSelect;

/** Parses the opaque `cursor` query param (the last-seen pageIndex). */
export function parsePageCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined || cursor === '') return undefined;
  if (!/^\d{1,9}$/.test(cursor)) throw new BadRequestException('cursor is invalid');
  return Number(cursor);
}

export function parsePageLimit(limit: string | undefined): number {
  if (limit === undefined || limit === '') return PAGE_LIST_DEFAULT_LIMIT;
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException('limit must be a positive integer');
  return Math.min(n, PAGE_LIST_MAX_LIMIT);
}

@Injectable()
export class WritingNotebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ─── Notebooks ───────────────────────────────────────────────────────────

  async listNotebooks(userId: string) {
    const notebooks = await this.prisma.writingNotebook.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
    const counts = await this.prisma.writingNotebookPage.groupBy({
      by: ['notebookId'],
      where: { userId },
      _count: { _all: true },
    });
    const countByNotebook = new Map(counts.map((c) => [c.notebookId, c._count._all]));
    return notebooks.map((n) => ({ ...n, pageCount: countByNotebook.get(n.id) ?? 0 }));
  }

  async createNotebook(userId: string, dto: CreateWritingNotebookDto) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('title must not be blank');
    const notebook = await this.prisma.writingNotebook.create({
      data: { userId, title },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
    await this.events.publish({
      userId,
      eventType: EventType.WRITING_NOTEBOOK_CREATED,
      sourceModule: SOURCE_MODULE,
      payload: { notebookId: notebook.id, title },
    });
    return { ...notebook, pageCount: 0 };
  }

  async updateNotebook(userId: string, id: string, dto: UpdateWritingNotebookDto) {
    await this.findOwnedNotebook(userId, id);
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('title must not be blank');
    const notebook = await this.prisma.writingNotebook.update({
      where: { id },
      data: { title },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
    const pageCount = await this.prisma.writingNotebookPage.count({ where: { notebookId: id, userId } });
    await this.events.publish({
      userId,
      eventType: EventType.WRITING_NOTEBOOK_UPDATED,
      sourceModule: SOURCE_MODULE,
      payload: { notebookId: id, title },
    });
    return { ...notebook, pageCount };
  }

  async deleteNotebook(userId: string, id: string) {
    await this.findOwnedNotebook(userId, id);
    // relationMode="prisma" emulates the Cascade, but deleting pages
    // explicitly keeps the intent obvious and scoped by userId.
    const { count } = await this.prisma.writingNotebookPage.deleteMany({ where: { notebookId: id, userId } });
    await this.prisma.writingNotebook.delete({ where: { id } });
    await this.events.publish({
      userId,
      eventType: EventType.WRITING_NOTEBOOK_DELETED,
      sourceModule: SOURCE_MODULE,
      payload: { notebookId: id, deletedPages: count },
    });
    return { message: 'Notebook deleted' };
  }

  // ─── Pages ───────────────────────────────────────────────────────────────

  async listPages(userId: string, notebookId: string, cursorParam?: string, limitParam?: string) {
    await this.findOwnedNotebook(userId, notebookId);
    const cursor = parsePageCursor(cursorParam);
    const limit = parsePageLimit(limitParam);

    const [rows, total, before] = await Promise.all([
      this.prisma.writingNotebookPage.findMany({
        where: { notebookId, userId, ...(cursor !== undefined && { pageIndex: { gt: cursor } }) },
        orderBy: { pageIndex: 'asc' },
        take: limit + 1,
        select: PAGE_SUMMARY_SELECT,
      }),
      this.prisma.writingNotebookPage.count({ where: { notebookId, userId } }),
      cursor === undefined
        ? Promise.resolve(0)
        : this.prisma.writingNotebookPage.count({ where: { notebookId, userId, pageIndex: { lte: cursor } } }),
    ]);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row, i) => ({
      ...row,
      // 1-based ordinal shown in the UI ("Trang 3"); stays dense even after
      // pages are deleted, unlike pageIndex.
      position: before + i + 1,
    }));
    return {
      items,
      nextCursor: hasMore ? String(items[items.length - 1].pageIndex) : null,
      total,
    };
  }

  async createPage(userId: string, notebookId: string, dto: CreateWritingPageDto) {
    await this.findOwnedNotebook(userId, notebookId);
    const { guides, traceMode } = this.normalizeTemplate(dto);

    // Atomic $inc — two concurrent creates can never be handed the same index.
    const allocated = await this.prisma.writingNotebook.update({
      where: { id: notebookId },
      data: { nextPageIndex: { increment: 1 } },
      select: { nextPageIndex: true },
    });
    const pageIndex = allocated.nextPageIndex - 1;

    const page = await this.prisma.writingNotebookPage.create({
      data: {
        notebookId,
        userId,
        pageIndex,
        templateType: dto.templateType,
        traceMode,
        gridConfig: { ...dto.gridConfig } as unknown as Prisma.InputJsonValue,
        guides: guides ? (guides as unknown as Prisma.InputJsonValue) : undefined,
        strokeCount: 0,
        version: 1,
      },
      select: PAGE_SUMMARY_SELECT,
    });

    await this.events.publish({
      userId,
      eventType: EventType.WRITING_PAGE_CREATED,
      sourceModule: SOURCE_MODULE,
      payload: { notebookId, pageId: page.id, pageIndex, templateType: dto.templateType },
    });
    return this.withNeighbours(userId, page, []);
  }

  async getPage(userId: string, notebookId: string, pageId: string) {
    const page = await this.prisma.writingNotebookPage.findFirst({
      where: { id: pageId, notebookId, userId },
      select: { ...PAGE_SUMMARY_SELECT, strokesData: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    const { strokesData, ...summary } = page;
    return this.withNeighbours(userId, summary, await decodeStrokes(strokesData));
  }

  async updatePage(userId: string, notebookId: string, pageId: string, dto: UpdateWritingPageDto) {
    const strokes = canonicalizeStrokes(dto.strokes);
    const strokesData = await encodeStrokes(serializeStrokes(strokes));
    const preview = buildPagePreview(strokes);

    // Optimistic concurrency: the version check and the write are a single
    // atomic conditional update, so two devices racing on the same page can
    // never both "win" against the same base version.
    const { count } = await this.prisma.writingNotebookPage.updateMany({
      where: { id: pageId, notebookId, userId, version: dto.version },
      data: {
        strokesData,
        strokeCount: strokes.length,
        preview: preview as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    if (count === 0) {
      const existing = await this.prisma.writingNotebookPage.findFirst({
        where: { id: pageId, notebookId, userId },
        select: { version: true },
      });
      if (!existing) throw new NotFoundException('Page not found');
      throw new ConflictException(
        `Page version is stale (sent ${dto.version}, current ${existing.version}). Reload the page and retry.`,
      );
    }

    const updatedAt = new Date();
    // Bumps the notebook's updatedAt so the notebook list sorts by recent writing.
    await this.prisma.writingNotebook.updateMany({ where: { id: notebookId, userId }, data: { updatedAt } });

    const version = dto.version + 1;
    await this.events.publish({
      userId,
      eventType: EventType.WRITING_PAGE_UPDATED,
      sourceModule: SOURCE_MODULE,
      payload: { notebookId, pageId, version, strokeCount: strokes.length },
    });
    return { id: pageId, notebookId, version, strokeCount: strokes.length, updatedAt };
  }

  async deletePage(userId: string, notebookId: string, pageId: string) {
    const page = await this.prisma.writingNotebookPage.findFirst({
      where: { id: pageId, notebookId, userId },
      select: { id: true, pageIndex: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.prisma.writingNotebookPage.delete({ where: { id: pageId } });
    await this.events.publish({
      userId,
      eventType: EventType.WRITING_PAGE_DELETED,
      sourceModule: SOURCE_MODULE,
      payload: { notebookId, pageId, pageIndex: page.pageIndex },
    });
    return { message: 'Page deleted' };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async findOwnedNotebook(userId: string, id: string) {
    // Same 404 for "doesn't exist" and "belongs to someone else" — never
    // reveal whether another user's id is valid.
    const notebook = await this.prisma.writingNotebook.findFirst({ where: { id, userId }, select: { id: true } });
    if (!notebook) throw new NotFoundException('Notebook not found');
    return notebook;
  }

  private normalizeTemplate(dto: CreateWritingPageDto): {
    guides: Array<{ row: number; character: string; pinyin: string }> | null;
    traceMode: WritingTraceMode | null;
  } {
    if (dto.templateType === WritingPageTemplate.BLANK) {
      if (dto.guides?.length) throw new BadRequestException('A BLANK page cannot have guide characters');
      return { guides: null, traceMode: null };
    }
    if (!dto.guides?.length) throw new BadRequestException('A GUIDED page needs at least one guide character');
    const rows = new Set<number>();
    const guides = dto.guides.map((g) => {
      if (g.row >= dto.gridConfig.rows) throw new BadRequestException('Guide row is outside the grid');
      if (rows.has(g.row)) throw new BadRequestException('Only one guide character per row');
      rows.add(g.row);
      const character = g.character.trim();
      if (!character) throw new BadRequestException('Guide character must not be blank');
      return { row: g.row, character, pinyin: (g.pinyin ?? '').trim() };
    });
    return { guides, traceMode: dto.traceMode ?? WritingTraceMode.FIRST_ONLY };
  }

  private async withNeighbours<T extends { id: string; notebookId: string; pageIndex: number }>(
    userId: string,
    page: T,
    strokes: unknown[],
  ) {
    const scope = { notebookId: page.notebookId, userId };
    const [prev, next, before, total] = await Promise.all([
      this.prisma.writingNotebookPage.findFirst({
        where: { ...scope, pageIndex: { lt: page.pageIndex } },
        orderBy: { pageIndex: 'desc' },
        select: { id: true },
      }),
      this.prisma.writingNotebookPage.findFirst({
        where: { ...scope, pageIndex: { gt: page.pageIndex } },
        orderBy: { pageIndex: 'asc' },
        select: { id: true },
      }),
      this.prisma.writingNotebookPage.count({ where: { ...scope, pageIndex: { lt: page.pageIndex } } }),
      this.prisma.writingNotebookPage.count({ where: scope }),
    ]);
    return {
      ...page,
      strokes,
      position: before + 1,
      totalPages: total,
      prevPageId: prev?.id ?? null,
      nextPageId: next?.id ?? null,
    };
  }
}
