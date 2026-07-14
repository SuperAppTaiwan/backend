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
  let recurrenceService: RecurrenceService;

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
    recurrenceService = module.get(RecurrenceService);
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
    const FIXED_NOW = new Date('2026-07-20T06:00:00.000Z'); // Monday 06:00 UTC = 14:00 Asia/Taipei

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(FIXED_NOW);
    });
    afterEach(() => {
      jest.useRealTimers();
    });

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

    it('avoids an existing fixed event when placing the AI_AUTO slot', async () => {
      // Block the entire morning (08:00-12:00 Asia/Taipei = 00:00-04:00 UTC) with a fixed event
      // on the same day as FIXED_NOW, so a MORNING-preferred AI task must skip to the next
      // available morning rather than overlapping it.
      prismaMock.fixedEvent.findMany.mockResolvedValue([
        makeFixedEvent({
          id: 'busy-morning',
          startTime: new Date('2026-07-21T00:00:00.000Z'), // 08:00 Taipei next day
          endTime: new Date('2026-07-21T04:00:00.000Z'), // 12:00 Taipei next day
        }),
      ]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeTask(), ...data, id: 'ai-avoid' }));

      const result = await service.createEvent('u1', {
        title: 'Avoid fixed event',
        schedulingMode: 'AI_AUTO',
        estimatedDurationMinutes: 60,
        constraints: { preferredTimeOfDay: 'MORNING', allowedWeekdays: ['TU'] }, // Jul 21 is Tuesday
      } as CreateScheduleEventDto);

      const start = new Date(result.startAt!);
      const end = new Date(result.endAt!);
      const busyStart = new Date('2026-07-21T00:00:00.000Z');
      const busyEnd = new Date('2026-07-21T04:00:00.000Z');
      const overlaps = start < busyEnd && end > busyStart;
      expect(overlaps).toBe(false);
    });

    it('never places the AI_AUTO slot after the given deadline', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeTask(), ...data, id: 'ai-deadline' }));

      const deadline = '2026-07-22T10:00:00.000Z';
      const result = await service.createEvent('u1', {
        title: 'Respect deadline',
        schedulingMode: 'AI_AUTO',
        estimatedDurationMinutes: 30,
        deadline,
      } as CreateScheduleEventDto);

      expect(new Date(result.endAt!).getTime()).toBeLessThanOrEqual(new Date(deadline).getTime());
    });

    it('returns 422 (not a late/incorrect slot) when the deadline is too tight for any valid slot', async () => {
      // FIXED_NOW is 14:00 Taipei; EVENING window is 18:00-22:00; a deadline just 1 hour from
      // now (15:00 Taipei) is well before the evening window even opens today, and the search
      // window itself collapses to under an hour with no allowed-weekday relaxation possible
      // (canSplit/allowedWeekdays untouched) — must reject, never silently return a bad slot.
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);

      await expect(
        service.createEvent('u1', {
          title: 'Impossible deadline',
          schedulingMode: 'AI_AUTO',
          estimatedDurationMinutes: 60,
          deadline: '2026-07-20T07:00:00.000Z', // 1 hour from FIXED_NOW
          constraints: { preferredTimeOfDay: 'EVENING' },
        } as CreateScheduleEventDto),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('respects earliest/latest allowed time-of-day window', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeTask(), ...data, id: 'ai-window' }));

      const result = await service.createEvent('u1', {
        title: 'Narrow window',
        schedulingMode: 'AI_AUTO',
        estimatedDurationMinutes: 60,
        constraints: { earliestStartTime: '20:00', latestEndTime: '21:00' },
      } as CreateScheduleEventDto);

      const localHour = new Date(result.startAt!).toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false });
      expect(localHour.trim().padStart(2, '0').slice(0, 2)).toBe('20');
    });

    it('respects allowedWeekdays (only places the slot on an allowed weekday)', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeTask(), ...data, id: 'ai-weekday' }));

      // FIXED_NOW is Monday; restrict to Saturday only.
      const result = await service.createEvent('u1', {
        title: 'Saturday only',
        schedulingMode: 'AI_AUTO',
        estimatedDurationMinutes: 60,
        deadline: '2026-08-01T00:00:00.000Z',
        constraints: { allowedWeekdays: ['SA'] },
      } as CreateScheduleEventDto);

      const weekday = new Date(result.startAt!).toLocaleString('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' });
      expect(weekday).toBe('Sat');
    });

    it('respects the requested duration exactly', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeTask(), ...data, id: 'ai-duration' }));

      const result = await service.createEvent('u1', {
        title: 'Exact duration',
        schedulingMode: 'AI_AUTO',
        estimatedDurationMinutes: 45,
      } as CreateScheduleEventDto);

      const durationMs = new Date(result.endAt!).getTime() - new Date(result.startAt!).getTime();
      expect(durationMs).toBe(45 * 60_000);
    });

    it('creates exactly one session (one Task row) when canSplit is false, never multiple partial blocks', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      prismaMock.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeTask(), ...data, id: 'ai-nosplit' }));

      await service.createEvent('u1', {
        title: 'No split',
        schedulingMode: 'AI_AUTO',
        estimatedDurationMinutes: 90,
        constraints: { canSplit: false },
      } as CreateScheduleEventDto);

      expect(prismaMock.task.create).toHaveBeenCalledTimes(1);
    });

    it('documents current behavior: a retried identical AI_AUTO request creates a second, separate task (no idempotency-key dedup exists anywhere in this API)', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);
      let counter = 0;
      prismaMock.task.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...makeTask(), ...data, id: `ai-retry-${counter++}` }));

      const payload = {
        title: 'Retried request',
        schedulingMode: 'AI_AUTO',
        estimatedDurationMinutes: 30,
      } as CreateScheduleEventDto;

      const first = await service.createEvent('u1', payload);
      const second = await service.createEvent('u1', payload);

      expect(first.id).not.toBe(second.id);
      expect(prismaMock.task.create).toHaveBeenCalledTimes(2);
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

    it('FOLLOWING scope on a COUNT-bounded series preserves the exact remaining COUNT (does not go unbounded)', async () => {
      // 10 weekly Mondays starting 2026-07-06: 07-06(1) 07-13(2) 07-20(3) 07-27(4) 08-03(5)
      // 08-10(6) 08-17(7) 08-24(8) 08-31(9) 09-07(10). Splitting AT occurrence #5 (08-03) means
      // 4 occurrences (#1-4) stay on the old (truncated) series and 6 occurrences (#5-10) must
      // land on the new series — i.e. the new series' rule must carry COUNT=6, not an unbounded
      // or NEVER-ending rule (which would silently fabricate occurrences #11+ that were never
      // part of the original 10-occurrence series).
      const master = makeFixedEvent({
        id: 'fe1',
        startTime: d('2026-07-06T09:00:00.000Z'),
        endTime: d('2026-07-06T10:00:00.000Z'),
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10',
        recurrenceTimezone: 'Asia/Taipei',
      });
      prismaMock.fixedEvent.findUnique.mockResolvedValue(master);
      prismaMock.fixedEvent.update.mockResolvedValue({ ...master, recurrenceEndAt: d('2026-08-02T23:59:59.000Z') });
      prismaMock.fixedEvent.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'fe2' }));

      const occurrenceStart = d('2026-08-03T09:00:00.000Z');
      const result = await service.updateEvent(
        'u1',
        'fixed-event',
        'fe1',
        {} as UpdateScheduleEventDto,
        'FOLLOWING',
        occurrenceStart,
      );

      expect(result.recurrenceRule).toContain('COUNT=6');
      expect(result.recurrenceRule).not.toContain('COUNT=10');

      // Expand the derived new-series rule over a generous window and confirm it produces
      // *exactly* 6 occurrences, the last being 2026-09-07 (the original series' true 10th and
      // final occurrence) — proving no extra/unbounded occurrences leak past what the original
      // 10-occurrence series would have produced.
      const expanded = recurrenceService.expandOccurrences(
        { id: 'fe2', startTime: occurrenceStart, endTime: d('2026-08-03T10:00:00.000Z'), recurrenceRule: result.recurrenceRule, recurrenceTimezone: 'Asia/Taipei', recurrenceEndAt: null },
        d('2026-08-01T00:00:00.000Z'),
        d('2027-01-01T00:00:00.000Z'),
      );
      expect(expanded).toHaveLength(6);
      expect(expanded[expanded.length - 1].occurrenceStart.toISOString().slice(0, 10)).toBe('2026-09-07');
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

    it('fails validation for an invalid recurrence.frequency', async () => {
      const dto = plainToInstance(CreateScheduleEventDto, {
        title: 'Bad recurrence',
        schedulingMode: 'FIXED',
        startAt: '2026-07-20T09:00:00.000Z',
        endAt: '2026-07-20T10:00:00.000Z',
        recurrence: { frequency: 'DAILY' },
      });
      const errors = await validate(dto);
      const recurrenceError = errors.find((e) => e.property === 'recurrence');
      expect(recurrenceError).toBeDefined();
      expect(recurrenceError?.children?.some((c) => c.property === 'frequency')).toBe(true);
    });

    it('fails validation for an out-of-range recurrence.interval', async () => {
      const dto = plainToInstance(CreateScheduleEventDto, {
        title: 'Bad interval',
        schedulingMode: 'FIXED',
        startAt: '2026-07-20T09:00:00.000Z',
        endAt: '2026-07-20T10:00:00.000Z',
        recurrence: { frequency: 'WEEKLY', interval: 0 },
      });
      const errors = await validate(dto);
      const recurrenceError = errors.find((e) => e.property === 'recurrence');
      expect(recurrenceError?.children?.some((c) => c.property === 'interval')).toBe(true);
    });

    it('fails validation for an invalid byWeekday code', async () => {
      const dto = plainToInstance(CreateScheduleEventDto, {
        title: 'Bad weekday',
        schedulingMode: 'FIXED',
        startAt: '2026-07-20T09:00:00.000Z',
        endAt: '2026-07-20T10:00:00.000Z',
        recurrence: { frequency: 'WEEKLY', byWeekday: ['ZZ'] },
      });
      const errors = await validate(dto);
      const recurrenceError = errors.find((e) => e.property === 'recurrence');
      expect(recurrenceError?.children?.some((c) => c.property === 'byWeekday')).toBe(true);
    });
  });

  // ── Standard error-body shape ───────────────────────────────────────────────

  describe('error response body shape', () => {
    it('409 conflict body matches the project-standard {statusCode, message, error} shape plus conflicts', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([
        makeFixedEvent({ id: 'fe1', startTime: d('2026-07-20T09:00:00Z'), endTime: d('2026-07-20T10:00:00Z') }),
      ]);
      prismaMock.task.findMany.mockResolvedValue([]);

      try {
        await service.createEvent('u1', {
          title: 'Conflict',
          schedulingMode: 'FIXED',
          startAt: '2026-07-20T09:30:00.000Z',
          endAt: '2026-07-20T10:30:00.000Z',
        } as CreateScheduleEventDto);
        throw new Error('expected ConflictException');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const body = (err as ConflictException).getResponse() as Record<string, unknown>;
        expect(body).toMatchObject({ statusCode: 409, error: 'Conflict', message: 'SCHEDULE_CONFLICT' });
        expect(Array.isArray(body.conflicts)).toBe(true);
      }
    });

    it('422 no-slot body matches the project-standard {statusCode, message, error} shape plus reason/suggestions', async () => {
      prismaMock.fixedEvent.findMany.mockResolvedValue([]);
      prismaMock.task.findMany.mockResolvedValue([]);

      try {
        await service.createEvent('u1', {
          title: 'No slot',
          schedulingMode: 'AI_AUTO',
          estimatedDurationMinutes: 60,
          constraints: {
            preferredDateRangeStart: '2026-07-01T00:00:00.000Z',
            preferredDateRangeEnd: '2026-06-30T00:00:00.000Z',
          },
        } as CreateScheduleEventDto);
        throw new Error('expected UnprocessableEntityException');
      } catch (err) {
        expect(err).toBeInstanceOf(UnprocessableEntityException);
        const body = (err as UnprocessableEntityException).getResponse() as Record<string, unknown>;
        expect(body).toMatchObject({ statusCode: 422, error: 'Unprocessable Entity', message: 'NO_SLOT_AVAILABLE' });
        expect(typeof body.reason).toBe('string');
        expect(Array.isArray(body.suggestions)).toBe(true);
      }
    });
  });

  // ── Ownership isolation (query-level) ───────────────────────────────────────

  describe('ownership isolation', () => {
    it('listEvents scopes both fixedEvent and task queries to the calling userId', async () => {
      await service.listEvents('u1', d('2026-07-01T00:00:00Z'), d('2026-07-31T00:00:00Z'));

      expect(prismaMock.fixedEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
      );
      expect(prismaMock.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
      );
    });

    it('recurrence-exception lookups are also scoped to the calling userId (no cross-user leak)', async () => {
      const master = makeFixedEvent({ id: 'fe1', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
      prismaMock.fixedEvent.findMany.mockResolvedValueOnce([master]).mockResolvedValueOnce([]);

      await service.listEvents('u1', d('2026-07-01T00:00:00Z'), d('2026-07-31T00:00:00Z'));

      const exceptionsCall = prismaMock.fixedEvent.findMany.mock.calls[1][0];
      expect(exceptionsCall.where).toEqual(
        expect.objectContaining({ userId: 'u1', isRecurrenceException: true }),
      );
    });

    it('checkConflicts scopes both fixedEvent and task queries to the calling userId', async () => {
      await service.checkConflicts('u1', d('2026-07-20T09:00:00Z'), d('2026-07-20T10:00:00Z'));

      expect(prismaMock.fixedEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
      );
      expect(prismaMock.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }) }),
      );
    });
  });

  // ── Conflict-check excludes cancelled/deleted/exception rows ───────────────

  describe('checkConflicts excludes cancelled and exception rows at the query level', () => {
    it('fixedEvent query filters isCancelled: false and isRecurrenceException: false', async () => {
      await service.checkConflicts('u1', d('2026-07-20T09:00:00Z'), d('2026-07-20T10:00:00Z'));

      expect(prismaMock.fixedEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isCancelled: false, isRecurrenceException: false }),
        }),
      );
    });

    it('task query filters isCancelled: false, isRecurrenceException: false, and schedulingMode FIXED', async () => {
      await service.checkConflicts('u1', d('2026-07-20T09:00:00Z'), d('2026-07-20T10:00:00Z'));

      expect(prismaMock.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isCancelled: false, isRecurrenceException: false, schedulingMode: 'FIXED' }),
        }),
      );
    });
  });

  // ── listEvents excludes cancelled/exception master rows ─────────────────────

  describe('listEvents excludes cancelled and raw-exception rows from the top-level query', () => {
    it('fixedEvent and task queries filter isCancelled: false and isRecurrenceException: false', async () => {
      await service.listEvents('u1', d('2026-07-01T00:00:00Z'), d('2026-07-31T00:00:00Z'));

      expect(prismaMock.fixedEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isCancelled: false, isRecurrenceException: false }),
        }),
      );
      expect(prismaMock.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isCancelled: false, isRecurrenceException: false }),
        }),
      );
    });
  });
});
