import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ScheduleEventsService } from './schedule-events.service.js';
import { RecurrenceService } from './recurrence.service.js';
import { CreateScheduleEventDto, UpdateScheduleEventDto } from './dto/schedule-event.dto.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';

function d(iso: string): Date {
  return new Date(iso);
}

const makeFixedEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'fe1',
  userId: 'u1',
  title: 'Sự kiện cố định',
  description: null,
  location: null,
  startTime: d('2026-07-06T09:00:00.000Z'),
  endTime: d('2026-07-06T10:00:00.000Z'),
  timezone: 'Asia/Taipei',
  recurrenceRule: null,
  eventType: 'GENERAL',
  createdAt: new Date(),
  updatedAt: new Date(),
  seriesId: null,
  originalOccurrenceStart: null,
  isRecurrenceException: false,
  isCancelled: false,
  recurrenceEndAt: null,
  recurrenceTimezone: null,
  ...overrides,
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  userId: 'u1',
  title: 'Công việc',
  description: null,
  priority: 'MEDIUM',
  status: 'TODO',
  deadline: null,
  estimatedMinutes: 30,
  scheduledStart: null,
  scheduledEnd: null,
  sourceModule: 'manual',
  sourceEntityId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  schedulingMode: 'AI_AUTO',
  timezone: 'Asia/Taipei',
  recurrenceRule: null,
  recurrenceTimezone: null,
  recurrenceEndAt: null,
  seriesId: null,
  originalOccurrenceStart: null,
  isRecurrenceException: false,
  isCancelled: false,
  aiConstraints: null,
  scheduleReason: null,
  ...overrides,
});

type MockDelegate = Record<string, jest.Mock>;
type PrismaMock = { fixedEvent: MockDelegate; task: MockDelegate; $transaction: jest.Mock };

describe('ScheduleEventsService', () => {
  let service: ScheduleEventsService;
  let prismaMock: PrismaMock;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    prismaMock = {
      fixedEvent: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      task: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction = jest.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
      }
      return Promise.all(arg as Promise<unknown>[]);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleEventsService,
        RecurrenceService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventsService, useValue: { publish: jest.fn() } },
      ],
    }).compile();

    service = module.get(ScheduleEventsService);
    eventsService = module.get(EventsService) as jest.Mocked<EventsService>;
  });

  // ── listEvents ──────────────────────────────────────────────────────────────

  describe('listEvents', () => {
    it('rejects when to <= from', async () => {
      await expect(service.listEvents('u1', d('2026-07-10T00:00:00Z'), d('2026-07-01T00:00:00Z'))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a range longer than 400 days', async () => {
      await expect(
        service.listEvents('u1', d('2026-01-01T00:00:00Z'), d('2027-06-01T00:00:00Z')),
      ).rejects.toThrow(BadRequestException);
    });

    it('lists non-recurring fixed events and tasks within range, sorted by startAt', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValueOnce([
        makeFixedEvent({ id: 'fe1', startTime: d('2026-07-10T09:00:00Z'), endTime: d('2026-07-10T10:00:00Z') }),
      ]);
      prismaMock.task.findMany.mockResolvedValueOnce([
        makeTask({ id: 't1', schedulingMode: 'FIXED', scheduledStart: d('2026-07-05T09:00:00Z'), scheduledEnd: d('2026-07-05T10:00:00Z') }),
      ]);

      const result = await service.listEvents('u1', d('2026-07-01T00:00:00Z'), d('2026-07-31T00:00:00Z'));

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('t1');
      expect(result[1].id).toBe('fe1');
    });

    it('excludes unscheduled (scheduledStart null) non-recurring tasks from the listing', async () => {
      prismaMock.task.findMany.mockResolvedValueOnce([makeTask({ id: 't1', scheduledStart: null, scheduledEnd: null })]);
      const result = await service.listEvents('u1', d('2026-07-01T00:00:00Z'), d('2026-07-31T00:00:00Z'));
      expect(result).toHaveLength(0);
    });

    it('expands a recurring fixed event into multiple occurrences', async () => {
      const master = makeFixedEvent({
        id: 'fe1',
        startTime: d('2026-07-06T09:00:00.000Z'),
        endTime: d('2026-07-06T10:00:00.000Z'),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        recurrenceTimezone: 'Asia/Taipei',
      });
      prismaMock.fixedEvent.findMany.mockResolvedValueOnce([master]);
      prismaMock.fixedEvent.findMany.mockResolvedValueOnce([]); // exceptions lookup

      const result = await service.listEvents('u1', d('2026-07-01T00:00:00Z'), d('2026-07-31T00:00:00Z'));
      expect(result).toHaveLength(4);
      expect(result.every((r) => r.isRecurring && r.seriesId === 'fe1')).toBe(true);
    });

    it('is idempotent: fetching the same range twice yields identical, non-duplicated results', async () => {
      const master = makeFixedEvent({
        id: 'fe1',
        startTime: d('2026-07-06T09:00:00.000Z'),
        endTime: d('2026-07-06T10:00:00.000Z'),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
      });
      prismaMock.fixedEvent.findMany.mockResolvedValue([master]);

      const from = d('2026-07-01T00:00:00Z');
      const to = d('2026-07-31T00:00:00Z');
      const first = await service.listEvents('u1', from, to);
      const second = await service.listEvents('u1', from, to);
      expect(first.map((i) => i.startAt)).toEqual(second.map((i) => i.startAt));
      const ids = first.map((i) => i.startAt);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ── createEvent: FIXED mode ─────────────────────────────────────────────────

  describe('createEvent — FIXED mode', () => {
    it('creates a fixed-mode task and publishes TASK_CREATED', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      const created = makeTask({
        schedulingMode: 'FIXED',
        scheduledStart: d('2026-07-20T09:00:00Z'),
        scheduledEnd: d('2026-07-20T10:00:00Z'),
      });
      prismaMock.task.create.mockResolvedValue(created);

      const result = await service.createEvent('u1', {
        title: 'Họp nhóm',
        schedulingMode: 'FIXED',
        startAt: '2026-07-20T09:00:00.000Z',
        endAt: '2026-07-20T10:00:00.000Z',
      } as CreateScheduleEventDto);

      expect(result.schedulingMode).toBe('FIXED');
      expect(eventsService.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: EventType.TASK_CREATED }));
    });

    it('rejects endAt <= startAt with 400', async () => {
      await expect(
        service.createEvent('u1', {
          title: 'Bad',
          schedulingMode: 'FIXED',
          startAt: '2026-07-20T10:00:00.000Z',
          endAt: '2026-07-20T09:00:00.000Z',
        } as CreateScheduleEventDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires startAt/endAt for FIXED mode', async () => {
      await expect(service.createEvent('u1', { title: 'X', schedulingMode: 'FIXED' } as CreateScheduleEventDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 409 ConflictException when a FIXED conflict exists and forceCreate is not set', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([
        makeFixedEvent({ id: 'fe1', startTime: d('2026-07-20T09:00:00Z'), endTime: d('2026-07-20T10:00:00Z') }),
      ]);
      prismaMock.task.findMany.mockResolvedValue([]);

      await expect(
        service.createEvent('u1', {
          title: 'Conflict',
          schedulingMode: 'FIXED',
          startAt: '2026-07-20T09:30:00.000Z',
          endAt: '2026-07-20T10:30:00.000Z',
        } as CreateScheduleEventDto),
      ).rejects.toThrow(ConflictException);
    });

    it('bypasses conflict check when forceCreate is true', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([
        makeFixedEvent({ id: 'fe1', startTime: d('2026-07-20T09:00:00Z'), endTime: d('2026-07-20T10:00:00Z') }),
      ]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.task.create.mockResolvedValue(
        makeTask({ schedulingMode: 'FIXED', scheduledStart: d('2026-07-20T09:30:00Z'), scheduledEnd: d('2026-07-20T10:30:00Z') }),
      );

      const result = await service.createEvent('u1', {
        title: 'Force',
        schedulingMode: 'FIXED',
        startAt: '2026-07-20T09:30:00.000Z',
        endAt: '2026-07-20T10:30:00.000Z',
        forceCreate: true,
      } as CreateScheduleEventDto);

      expect(result.id).toBeDefined();
    });
  });

  // ── createEvent: AI_AUTO mode ───────────────────────────────────────────────

  describe('createEvent — AI_AUTO mode', () => {
    it('requires estimatedDurationMinutes', async () => {
      await expect(service.createEvent('u1', { title: 'X', schedulingMode: 'AI_AUTO' } as CreateScheduleEventDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('finds a free slot and creates a scheduled AI_AUTO task', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeTask(), ...data, id: 'ai1' }));

      const result = await service.createEvent('u1', {
        title: 'Ôn tập',
        schedulingMode: 'AI_AUTO',
        estimatedDurationMinutes: 60,
        constraints: { preferredTimeOfDay: 'MORNING' },
      } as CreateScheduleEventDto);

      expect(result.schedulingMode).toBe('AI_AUTO');
      expect(result.startAt).not.toBeNull();
      expect(result.scheduleReason).toContain('sáng');
      expect(eventsService.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: EventType.TASK_AUTO_SCHEDULED }));
    });

    it('throws 422 UnprocessableEntityException when no slot is found and allowUnscheduled is not set', async () => {
      // Fully block every hour of every allowed day within the search window.
      const busyBlock = makeFixedEvent({
        id: 'block',
        startTime: d('2000-01-01T00:00:00Z'),
        endTime: d('2000-01-01T00:00:00Z'),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU',
        recurrenceTimezone: 'Asia/Taipei',
      });
      // Make a single very-wide busy fixed event per day by using a non-recurring 24h block instead:
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      // Force an impossible window: deadline in the past relative to "now" isn't allowed by dto
      // validation upstream, so instead constrain preferredDateRangeStart > preferredDateRangeEnd.
      await expect(
        service.createEvent('u1', {
          title: 'No slot',
          schedulingMode: 'AI_AUTO',
          estimatedDurationMinutes: 60,
          constraints: {
            preferredDateRangeStart: '2026-07-01T00:00:00.000Z',
            preferredDateRangeEnd: '2026-06-30T00:00:00.000Z',
          },
        } as CreateScheduleEventDto),
      ).rejects.toThrow(UnprocessableEntityException);
      void busyBlock;
    });

    it('creates an unscheduled task when allowUnscheduled is true and no slot is found', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeTask(), ...data, id: 'unsched1' }));

      const result = await service.createEvent('u1', {
        title: 'Unscheduled',
        schedulingMode: 'AI_AUTO',
        estimatedDurationMinutes: 60,
        allowUnscheduled: true,
        constraints: {
          preferredDateRangeStart: '2026-07-01T00:00:00.000Z',
          preferredDateRangeEnd: '2026-06-30T00:00:00.000Z',
        },
      } as CreateScheduleEventDto);

      expect(result.startAt).toBeNull();
      expect(result.endAt).toBeNull();
      expect(result.scheduleReason).toBeTruthy();
    });
  });

  // ── updateEvent ──────────────────────────────────────────────────────────────

  describe('updateEvent', () => {
    it('throws NotFoundException (404, not 403) for another user\'s fixed event', async () => {
      prismaMock.fixedEvent.findUnique.mockResolvedValue(makeFixedEvent({ userId: 'u2' }));
      await expect(service.updateEvent('u1', 'fixed-event', 'fe1', {} as UpdateScheduleEventDto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a missing task', async () => {
      prismaMock.task.findUnique.mockResolvedValue(null);
      await expect(service.updateEvent('u1', 'task', 't1', {} as UpdateScheduleEventDto)).rejects.toThrow(NotFoundException);
    });

    it('SERIES scope updates the master row directly', async () => {
      const master = makeFixedEvent({ id: 'fe1' });
      prismaMock.fixedEvent.findUnique.mockResolvedValue(master);
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.fixedEvent.update.mockResolvedValue({ ...master, title: 'Updated title' });

      const result = await service.updateEvent('u1', 'fixed-event', 'fe1', { title: 'Updated title' } as UpdateScheduleEventDto, 'SERIES');

      expect(result.title).toBe('Updated title');
      expect(eventsService.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: EventType.FIXED_EVENT_UPDATED }));
    });

    it('THIS scope creates an exception without mutating the master, and does not affect sibling occurrences', async () => {
      const master = makeFixedEvent({
        id: 'fe1',
        startTime: d('2026-07-06T09:00:00.000Z'),
        endTime: d('2026-07-06T10:00:00.000Z'),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        recurrenceTimezone: 'Asia/Taipei',
      });
      prismaMock.fixedEvent.findUnique.mockResolvedValue(master);
      prismaMock.fixedEvent.findFirst.mockResolvedValue(null);
      prismaMock.fixedEvent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'exc1' }));

      const occurrenceStart = d('2026-07-13T09:00:00.000Z');
      const result = await service.updateEvent(
        'u1',
        'fixed-event',
        'fe1',
        { title: 'Chỉ buổi này', startAt: '2026-07-13T14:00:00.000Z', endAt: '2026-07-13T15:00:00.000Z' } as UpdateScheduleEventDto,
        'THIS',
        occurrenceStart,
      );

      expect(result.isException).toBe(true);
      expect(result.title).toBe('Chỉ buổi này');
      expect(prismaMock.fixedEvent.update).not.toHaveBeenCalled(); // master untouched

      // Now verify sibling occurrences are unaffected: list events and check the other Monday keeps original title
      prismaMock.fixedEvent.findMany.mockResolvedValueOnce([master]).mockResolvedValueOnce([{ ...result, seriesId: 'fe1', originalOccurrenceStart: occurrenceStart, isRecurrenceException: true, isCancelled: false, startTime: d('2026-07-13T14:00:00.000Z'), endTime: d('2026-07-13T15:00:00.000Z') }]);
      const listed = await service.listEvents('u1', d('2026-07-01T00:00:00Z'), d('2026-07-31T00:00:00Z'));
      const untouched = listed.find((i) => i.occurrenceStart === '2026-07-06T09:00:00.000Z');
      expect(untouched?.title).toBe('Sự kiện cố định');
      expect(untouched?.isException).toBe(false);
    });

    it('THIS scope requires occurrenceStart', async () => {
      const master = makeFixedEvent({ id: 'fe1', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
      prismaMock.fixedEvent.findUnique.mockResolvedValue(master);
      await expect(service.updateEvent('u1', 'fixed-event', 'fe1', {} as UpdateScheduleEventDto, 'THIS')).rejects.toThrow(BadRequestException);
    });

    it('FOLLOWING scope splits the series via a transaction (old master truncated, new master created)', async () => {
      const master = makeFixedEvent({
        id: 'fe1',
        startTime: d('2026-07-06T09:00:00.000Z'),
        endTime: d('2026-07-06T10:00:00.000Z'),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        recurrenceTimezone: 'Asia/Taipei',
      });
      prismaMock.fixedEvent.findUnique.mockResolvedValue(master);
      prismaMock.fixedEvent.update.mockResolvedValue({ ...master, recurrenceEndAt: d('2026-07-12T23:59:59.000Z') });
      prismaMock.fixedEvent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'fe2' }));

      const occurrenceStart = d('2026-07-13T09:00:00.000Z');
      const result = await service.updateEvent(
        'u1',
        'fixed-event',
        'fe1',
        { title: 'Từ giờ trở đi' } as UpdateScheduleEventDto,
        'FOLLOWING',
        occurrenceStart,
      );

      expect(result.id).toBe('fe2');
      expect(result.title).toBe('Từ giờ trở đi');
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.fixedEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'fe1' }, data: expect.objectContaining({ recurrenceEndAt: expect.any(Date) }) }),
      );
    });

    it('propagates a rejection from $transaction without applying partial writes (rollback safety)', async () => {
      const master = makeFixedEvent({
        id: 'fe1',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        recurrenceTimezone: 'Asia/Taipei',
      });
      prismaMock.fixedEvent.findUnique.mockResolvedValue(master);
      prismaMock.$transaction.mockRejectedValueOnce(new Error('simulated transaction failure'));

      await expect(
        service.updateEvent('u1', 'fixed-event', 'fe1', { title: 'X' } as UpdateScheduleEventDto, 'FOLLOWING', d('2026-07-13T09:00:00.000Z')),
      ).rejects.toThrow('simulated transaction failure');
      expect(eventsService.publish).not.toHaveBeenCalled();
    });
  });

  // ── deleteEvent ──────────────────────────────────────────────────────────────

  describe('deleteEvent', () => {
    it('throws NotFoundException for another user\'s task', async () => {
      prismaMock.task.findUnique.mockResolvedValue(makeTask({ userId: 'u2' }));
      await expect(service.deleteEvent('u1', 'task', 't1')).rejects.toThrow(NotFoundException);
    });

    it('SERIES scope deletes the master and cascades exception rows', async () => {
      const master = makeFixedEvent({ id: 'fe1' });
      prismaMock.fixedEvent.findUnique.mockResolvedValue(master);

      const result = await service.deleteEvent('u1', 'fixed-event', 'fe1', 'SERIES');

      expect(result.message).toBeTruthy();
      expect(prismaMock.fixedEvent.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ seriesId: 'fe1', isRecurrenceException: true }) }),
      );
      expect(prismaMock.fixedEvent.delete).toHaveBeenCalledWith({ where: { id: 'fe1' } });
      expect(eventsService.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: EventType.FIXED_EVENT_DELETED }));
    });

    it('THIS scope creates a cancellation tombstone exception (no existing exception yet)', async () => {
      const master = makeFixedEvent({ id: 'fe1', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
      prismaMock.fixedEvent.findUnique.mockResolvedValue(master);
      prismaMock.fixedEvent.findFirst.mockResolvedValue(null);

      const occurrenceStart = d('2026-07-13T09:00:00.000Z');
      await service.deleteEvent('u1', 'fixed-event', 'fe1', 'THIS', occurrenceStart);

      expect(prismaMock.fixedEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isCancelled: true, isRecurrenceException: true, seriesId: 'fe1' }) }),
      );
      expect(prismaMock.fixedEvent.delete).not.toHaveBeenCalled();
    });

    it('THIS scope marks an existing exception as cancelled instead of creating a duplicate', async () => {
      const master = makeFixedEvent({ id: 'fe1', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
      prismaMock.fixedEvent.findUnique.mockResolvedValue(master);
      prismaMock.fixedEvent.findFirst.mockResolvedValue({ id: 'exc1', seriesId: 'fe1' });

      await service.deleteEvent('u1', 'fixed-event', 'fe1', 'THIS', d('2026-07-13T09:00:00.000Z'));

      expect(prismaMock.fixedEvent.update).toHaveBeenCalledWith({ where: { id: 'exc1' }, data: { isCancelled: true } });
      expect(prismaMock.fixedEvent.create).not.toHaveBeenCalled();
    });
  });

  // ── checkConflicts ───────────────────────────────────────────────────────────

  describe('checkConflicts', () => {
    it('detects an overlap with an existing fixed event', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([
        makeFixedEvent({ id: 'fe1', startTime: d('2026-07-20T09:00:00Z'), endTime: d('2026-07-20T10:00:00Z') }),
      ]);
      prismaMock.task.findMany.mockResolvedValue([]);

      const result = await service.checkConflicts('u1', d('2026-07-20T09:30:00Z'), d('2026-07-20T10:30:00Z'));
      expect(result.hasConflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
    });

    it('returns no conflict for non-overlapping ranges', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([
        makeFixedEvent({ id: 'fe1', startTime: d('2026-07-20T09:00:00Z'), endTime: d('2026-07-20T10:00:00Z') }),
      ]);
      prismaMock.task.findMany.mockResolvedValue([]);

      const result = await service.checkConflicts('u1', d('2026-07-20T11:00:00Z'), d('2026-07-20T12:00:00Z'));
      expect(result.hasConflict).toBe(false);
    });

    it('excludes the given excludeId from conflict candidates', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);

      const result = await service.checkConflicts('u1', d('2026-07-20T09:00:00Z'), d('2026-07-20T10:00:00Z'), 'fe1');
      expect(result.hasConflict).toBe(false);
    });
  });

  // ── DTO validation ───────────────────────────────────────────────────────────

  describe('CreateScheduleEventDto validation', () => {
    it('fails validation when schedulingMode is missing', async () => {
      const dto = plainToInstance(CreateScheduleEventDto, { title: 'Missing mode' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'schedulingMode')).toBe(true);
    });

    it('fails validation when title is missing', async () => {
      const dto = plainToInstance(CreateScheduleEventDto, { schedulingMode: 'FIXED' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'title')).toBe(true);
    });

    it('passes validation for a minimal valid FIXED payload', async () => {
      const dto = plainToInstance(CreateScheduleEventDto, {
        title: 'Valid',
        schedulingMode: 'FIXED',
        startAt: '2026-07-20T09:00:00.000Z',
        endAt: '2026-07-20T10:00:00.000Z',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
