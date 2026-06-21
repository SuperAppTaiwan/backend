import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ScheduleService } from './schedule.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';

const DATE = '2026-07-15';

function localTime(dateStr: string, hour: number, minute = 0): Date {
  const d = new Date(dateStr);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const makeEvent = (overrides = {}) => ({
  id: 'e1', userId: 'u1', title: 'Lớp tiếng Trung', description: null, location: null,
  startTime: localTime(DATE, 9), endTime: localTime(DATE, 11),
  timezone: 'Asia/Taipei', recurrenceRule: null, eventType: 'CLASS',
  createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const makeTask = (overrides = {}) => ({
  id: 't1', userId: 'u1', title: 'Ôn bài', description: null,
  priority: 'MEDIUM', status: 'TODO', deadline: null,
  estimatedMinutes: 30, scheduledStart: null, scheduledEnd: null,
  sourceModule: 'manual', sourceEntityId: null, createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

describe('ScheduleService', () => {
  let service: ScheduleService;
  let prisma: jest.Mocked<PrismaService>;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleService,
        {
          provide: PrismaService,
          useValue: {
            fixedEvent: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            task: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            schedulePlan: {
              create: jest.fn(),
            },
          },
        },
        {
          provide: EventsService,
          useValue: { publish: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ScheduleService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    eventsService = module.get(EventsService) as jest.Mocked<EventsService>;
  });

  describe('createFixedEvent', () => {
    it('creates event and publishes FIXED_EVENT_CREATED', async () => {
      const ev = makeEvent();
      (prisma.fixedEvent.create as jest.Mock).mockResolvedValue(ev);

      const result = await service.createFixedEvent('u1', {
        title: 'Lớp tiếng Trung',
        startTime: `${DATE}T09:00:00Z`,
        endTime: `${DATE}T11:00:00Z`,
      });

      expect(result.id).toBe('e1');
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.FIXED_EVENT_CREATED }),
      );
    });
  });

  describe('findFixedEvent', () => {
    it('throws NotFoundException for missing event', async () => {
      (prisma.fixedEvent.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.findFixedEvent('u1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for another user event', async () => {
      (prisma.fixedEvent.findUnique as jest.Mock).mockResolvedValue(makeEvent({ userId: 'u2' }));
      await expect(service.findFixedEvent('u1', 'e1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createTask', () => {
    it('creates task and publishes TASK_CREATED', async () => {
      const task = makeTask();
      (prisma.task.create as jest.Mock).mockResolvedValue(task);

      const result = await service.createTask('u1', { title: 'Ôn bài' });

      expect(result.id).toBe('t1');
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.TASK_CREATED }),
      );
    });
  });

  describe('findTask', () => {
    it('throws NotFoundException for missing task', async () => {
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.findTask('u1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for another user task', async () => {
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(makeTask({ userId: 'u2' }));
      await expect(service.findTask('u1', 't1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('completeTask', () => {
    it('sets status COMPLETED and publishes TASK_COMPLETED', async () => {
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(makeTask());
      const completed = makeTask({ status: 'COMPLETED' });
      (prisma.task.update as jest.Mock).mockResolvedValue(completed);

      const result = await service.completeTask('u1', 't1');

      expect(result.status).toBe('COMPLETED');
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.TASK_COMPLETED }),
      );
    });
  });

  describe('autoSchedule', () => {
    it('schedules task in gap before fixed event', async () => {
      const fixedEv = makeEvent({
        startTime: localTime(DATE, 9),
        endTime: localTime(DATE, 11),
      });
      const task = makeTask({ estimatedMinutes: 30 });

      (prisma.fixedEvent.findMany as jest.Mock).mockResolvedValue([fixedEv]);
      (prisma.task.findMany as jest.Mock).mockResolvedValue([task]);
      const updatedTask = { ...task, scheduledStart: localTime(DATE, 8), scheduledEnd: localTime(DATE, 8, 30) };
      (prisma.task.update as jest.Mock).mockResolvedValue(updatedTask);
      (prisma.task.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.schedulePlan.create as jest.Mock).mockResolvedValue({
        id: 'sp1', summary: 'Đã lên lịch 1 công việc, 0 chưa được xếp lịch',
      });

      const result = await service.autoSchedule('u1', { date: DATE });

      expect(result.scheduledTasks).toHaveLength(1);
      expect(result.unscheduledTasks).toHaveLength(0);
      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.SCHEDULE_PLAN_GENERATED }),
      );
    });

    it('puts task in unscheduledTasks when no gap available', async () => {
      const fixedEv = makeEvent({
        startTime: localTime(DATE, 8),
        endTime: localTime(DATE, 22),
      });
      const task = makeTask({ estimatedMinutes: 60 });

      (prisma.fixedEvent.findMany as jest.Mock).mockResolvedValue([fixedEv]);
      (prisma.task.findMany as jest.Mock).mockResolvedValue([task]);
      (prisma.task.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prisma.schedulePlan.create as jest.Mock).mockResolvedValue({
        id: 'sp1', summary: 'Đã lên lịch 0 công việc, 1 chưa được xếp lịch',
      });

      const result = await service.autoSchedule('u1', { date: DATE });

      expect(result.scheduledTasks).toHaveLength(0);
      expect(result.unscheduledTasks).toHaveLength(1);
    });
  });

  describe('getConflicts', () => {
    it('detects overlapping fixed events', async () => {
      const ev1 = makeEvent({ id: 'e1', startTime: localTime(DATE, 9), endTime: localTime(DATE, 11) });
      const ev2 = makeEvent({ id: 'e2', startTime: localTime(DATE, 10), endTime: localTime(DATE, 12) });

      (prisma.fixedEvent.findMany as jest.Mock).mockResolvedValue([ev1, ev2]);
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getConflicts('u1', DATE);

      expect(result.conflictCount).toBe(1);
      expect(result.conflicts[0].type).toBe('FIXED_OVERLAP');
    });

    it('returns no conflicts when events do not overlap', async () => {
      const ev1 = makeEvent({ id: 'e1', startTime: localTime(DATE, 9), endTime: localTime(DATE, 10) });
      const ev2 = makeEvent({ id: 'e2', startTime: localTime(DATE, 11), endTime: localTime(DATE, 12) });

      (prisma.fixedEvent.findMany as jest.Mock).mockResolvedValue([ev1, ev2]);
      (prisma.task.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getConflicts('u1', DATE);

      expect(result.conflictCount).toBe(0);
    });
  });

  describe('getProductivityInsights', () => {
    it('calculates completion rate and overdue count', async () => {
      (prisma.task.count as jest.Mock)
        .mockResolvedValueOnce(5)   // completedThisWeek
        .mockResolvedValueOnce(2)   // overdueTasks
        .mockResolvedValueOnce(10)  // totalTasks
        .mockResolvedValueOnce(6);  // completedTotal

      const result = await service.getProductivityInsights('u1');

      expect(result.completedTasksThisWeek).toBe(5);
      expect(result.overdueTasks).toBe(2);
      expect(result.completionRate).toBe(60);
    });

    it('suggests addressing overdue when >5 tasks are overdue', async () => {
      (prisma.task.count as jest.Mock)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(5);

      const result = await service.getProductivityInsights('u1');

      expect(result.suggestion).toContain('quá hạn');
    });
  });

  describe('deleteFixedEvent', () => {
    it('publishes FIXED_EVENT_DELETED', async () => {
      (prisma.fixedEvent.findUnique as jest.Mock).mockResolvedValue(makeEvent());
      (prisma.fixedEvent.delete as jest.Mock).mockResolvedValue({});

      await service.deleteFixedEvent('u1', 'e1');

      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.FIXED_EVENT_DELETED }),
      );
    });
  });

  describe('deleteTask', () => {
    it('publishes TASK_DELETED', async () => {
      (prisma.task.findUnique as jest.Mock).mockResolvedValue(makeTask());
      (prisma.task.delete as jest.Mock).mockResolvedValue({});

      await service.deleteTask('u1', 't1');

      expect(eventsService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: EventType.TASK_DELETED }),
      );
    });
  });
});
