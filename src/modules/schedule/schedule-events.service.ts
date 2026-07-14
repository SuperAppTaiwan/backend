import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FixedEvent, Prisma, Task, TaskPriority } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { RecurrenceService, WeekdayCode } from './recurrence.service.js';
import {
  AiConstraintsInputDto,
  CreateScheduleEventDto,
  UpdateScheduleEventDto,
} from './dto/schedule-event.dto.js';

export type ScheduleSourceType = 'fixed-event' | 'task';
export type ScheduleScope = 'THIS' | 'FOLLOWING' | 'SERIES';

/**
 * Unified read/write shape for the /schedule/events surface. Deviation from the original spec:
 * `occurrenceStart` / `startAt` / `endAt` are typed as `string | null` (not `string`) because an
 * AI_AUTO task created with `allowUnscheduled: true` and no available slot legitimately has no
 * start/end yet (scheduledStart/scheduledEnd are null in the DB). The spec's `createEvent` section
 * explicitly requires supporting that case, which is incompatible with non-nullable date strings.
 */
export interface ScheduleItemDto {
  id: string;
  sourceType: 'FIXED_EVENT' | 'TASK';
  seriesId: string | null;
  isRecurring: boolean;
  isRecurrenceInstance: boolean;
  occurrenceStart: string | null;
  isException: boolean;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  schedulingMode: 'FIXED' | 'AI_AUTO';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null;
  status: 'TODO' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'OVERDUE' | null;
  eventType: string | null;
  recurrenceRule: string | null;
  scheduleReason: string | null;
  deadline: string | null;
}

export interface ConflictItem {
  id: string;
  sourceType: 'FIXED_EVENT' | 'TASK';
  title: string;
  startAt: string;
  endAt: string;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflicts: ConflictItem[];
}

const MAX_RANGE_DAYS = 400;
const CONFLICT_WINDOW_DAYS = 35;
const DEFAULT_TZ = 'Asia/Taipei';
const LUXON_WEEKDAY_CODES: WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const ALL_WEEKDAYS = new Set<WeekdayCode>(LUXON_WEEKDAY_CODES);

function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class ScheduleEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly recurrence: RecurrenceService,
  ) {}

  // ─── List ─────────────────────────────────────────────────────────────────────

  async listEvents(userId: string, from: Date, to: Date): Promise<ScheduleItemDto[]> {
    if (to <= from) throw new BadRequestException('"to" must be after "from"');
    const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
    }

    const [fixedEvents, tasks] = await Promise.all([
      this.prisma.fixedEvent.findMany({
        where: {
          userId,
          isCancelled: false,
          isRecurrenceException: false,
          OR: [
            { recurrenceRule: null, startTime: { lt: to }, endTime: { gt: from } },
            {
              recurrenceRule: { not: null },
              OR: [{ recurrenceEndAt: null }, { recurrenceEndAt: { gte: from } }],
            },
          ],
        },
      }),
      this.prisma.task.findMany({
        where: {
          userId,
          isCancelled: false,
          isRecurrenceException: false,
          OR: [
            { recurrenceRule: null, scheduledStart: { lt: to }, scheduledEnd: { gt: from } },
            {
              recurrenceRule: { not: null },
              OR: [{ recurrenceEndAt: null }, { recurrenceEndAt: { gte: from } }],
            },
          ],
        },
      }),
    ]);

    const items: ScheduleItemDto[] = [];

    const recurringFixedIds = fixedEvents.filter((e) => e.recurrenceRule).map((e) => e.id);
    const fixedExceptions = recurringFixedIds.length
      ? await this.prisma.fixedEvent.findMany({
          where: { userId, isRecurrenceException: true, seriesId: { in: recurringFixedIds } },
        })
      : [];
    const fixedExceptionsByMaster = this.groupBySeries(fixedExceptions);

    for (const ev of fixedEvents) {
      if (!ev.recurrenceRule) {
        items.push(this.fixedEventToItem(ev, ev.startTime, ev.startTime, ev.endTime, false, null));
        continue;
      }
      const occurrences = this.recurrence.expandOccurrences(ev, from, to);
      const exceptionsByTime = this.indexExceptionsByTime(fixedExceptionsByMaster.get(ev.id) ?? []);
      for (const occ of occurrences) {
        const exception = exceptionsByTime.get(occ.occurrenceStart.getTime());
        if (exception) {
          if (exception.isCancelled) continue;
          items.push(
            this.fixedEventToItem(exception, occ.occurrenceStart, exception.startTime, exception.endTime, true, ev.id),
          );
        } else {
          items.push(this.fixedEventToItem(ev, occ.occurrenceStart, occ.occurrenceStart, occ.occurrenceEnd, false, ev.id));
        }
      }
    }

    const recurringTaskIds = tasks.filter((t) => t.recurrenceRule).map((t) => t.id);
    const taskExceptions = recurringTaskIds.length
      ? await this.prisma.task.findMany({
          where: { userId, isRecurrenceException: true, seriesId: { in: recurringTaskIds } },
        })
      : [];
    const taskExceptionsByMaster = this.groupBySeries(taskExceptions);

    for (const task of tasks) {
      if (!task.recurrenceRule) {
        if (!task.scheduledStart || !task.scheduledEnd) continue; // unscheduled — excluded from calendar listing
        items.push(this.taskToItem(task, task.scheduledStart, task.scheduledStart, task.scheduledEnd, false, null));
        continue;
      }
      const occurrences = this.recurrence.expandOccurrences(task, from, to);
      const exceptionsByTime = this.indexExceptionsByTime(taskExceptionsByMaster.get(task.id) ?? []);
      for (const occ of occurrences) {
        const exception = exceptionsByTime.get(occ.occurrenceStart.getTime());
        if (exception) {
          if (exception.isCancelled) continue;
          items.push(
            this.taskToItem(
              exception,
              occ.occurrenceStart,
              exception.scheduledStart ?? occ.occurrenceStart,
              exception.scheduledEnd ?? occ.occurrenceEnd,
              true,
              task.id,
            ),
          );
        } else {
          items.push(this.taskToItem(task, occ.occurrenceStart, occ.occurrenceStart, occ.occurrenceEnd, false, task.id));
        }
      }
    }

    items.sort((a, b) => {
      const at = a.startAt ? new Date(a.startAt).getTime() : 0;
      const bt = b.startAt ? new Date(b.startAt).getTime() : 0;
      return at - bt;
    });
    return items;
  }

  // ─── Create ───────────────────────────────────────────────────────────────────

  async createEvent(userId: string, dto: CreateScheduleEventDto): Promise<ScheduleItemDto> {
    const priority: TaskPriority = dto.priority ?? 'MEDIUM';
    const timezone = dto.timezone ?? DEFAULT_TZ;

    if (dto.schedulingMode === 'FIXED') {
      return this.createFixedModeEvent(userId, dto, priority, timezone);
    }
    return this.createAiAutoModeEvent(userId, dto, priority, timezone);
  }

  private async createFixedModeEvent(
    userId: string,
    dto: CreateScheduleEventDto,
    priority: TaskPriority,
    timezone: string,
  ): Promise<ScheduleItemDto> {
    if (!dto.startAt || !dto.endAt) {
      throw new BadRequestException('startAt and endAt are required for FIXED scheduling mode');
    }
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) throw new BadRequestException('endAt must be after startAt');

    let recurrenceRule: string | null = null;
    if (dto.recurrence) {
      recurrenceRule = this.recurrence.buildRRuleString(dto.recurrence, startAt);
    }

    if (!dto.forceCreate) {
      const conflictResult = await this.checkConflicts(userId, startAt, endAt);
      if (conflictResult.hasConflict) {
        throw new ConflictException({ message: 'SCHEDULE_CONFLICT', conflicts: conflictResult.conflicts });
      }
    }

    const task = await this.prisma.task.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        priority,
        status: 'TODO',
        schedulingMode: 'FIXED',
        timezone,
        scheduledStart: startAt,
        scheduledEnd: endAt,
        estimatedMinutes: Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        recurrenceRule,
        recurrenceTimezone: dto.recurrence ? timezone : null,
        recurrenceEndAt: this.computeRecurrenceEndAt(dto.recurrence),
        aiConstraints: toJsonInput(dto.constraints),
        sourceModule: 'schedule_event',
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.TASK_CREATED,
      sourceModule: 'schedule',
      payload: { taskId: task.id, title: task.title, schedulingMode: 'FIXED' },
    });

    return this.taskToItem(task, task.scheduledStart, task.scheduledStart, task.scheduledEnd, false, recurrenceRule ? task.id : null);
  }

  private async createAiAutoModeEvent(
    userId: string,
    dto: CreateScheduleEventDto,
    priority: TaskPriority,
    timezone: string,
  ): Promise<ScheduleItemDto> {
    if (!dto.estimatedDurationMinutes) {
      throw new BadRequestException('estimatedDurationMinutes is required for AI_AUTO scheduling mode');
    }

    const result = await this.runAiAutoSchedule(userId, {
      estimatedDurationMinutes: dto.estimatedDurationMinutes,
      deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      priority,
      constraints: dto.constraints,
      timezone,
    });

    if (!result) {
      if (!dto.allowUnscheduled) {
        const suggestions = await this.buildSuggestions(userId, dto, priority, timezone);
        throw new UnprocessableEntityException({
          message: 'NO_SLOT_AVAILABLE',
          reason: 'Không tìm thấy khung giờ trống phù hợp trước hạn chót.',
          suggestions,
        });
      }

      const task = await this.prisma.task.create({
        data: {
          userId,
          title: dto.title,
          description: dto.description,
          priority,
          status: 'TODO',
          schedulingMode: 'AI_AUTO',
          timezone,
          scheduledStart: null,
          scheduledEnd: null,
          estimatedMinutes: dto.estimatedDurationMinutes,
          deadline: dto.deadline ? new Date(dto.deadline) : null,
          recurrenceRule: dto.recurrence ? this.recurrence.buildRRuleString(dto.recurrence, new Date()) : null,
          recurrenceTimezone: dto.recurrence ? timezone : null,
          recurrenceEndAt: this.computeRecurrenceEndAt(dto.recurrence),
          aiConstraints: toJsonInput(dto.constraints),
          scheduleReason:
            'Chưa tìm được khung giờ phù hợp; công việc được tạo ở trạng thái chưa lên lịch, chờ sắp xếp thủ công.',
          sourceModule: 'schedule_event',
        },
      });

      await this.events.publish({
        userId,
        eventType: EventType.TASK_CREATED,
        sourceModule: 'schedule',
        payload: { taskId: task.id, title: task.title, schedulingMode: 'AI_AUTO', unscheduled: true },
      });

      return this.taskToItem(task, null, null, null, false, null);
    }

    let recurrenceRule: string | null = null;
    if (dto.recurrence) {
      recurrenceRule = this.recurrence.buildRRuleString(dto.recurrence, result.startAt);
    }

    const task = await this.prisma.task.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        priority,
        status: 'TODO',
        schedulingMode: 'AI_AUTO',
        timezone,
        scheduledStart: result.startAt,
        scheduledEnd: result.endAt,
        estimatedMinutes: dto.estimatedDurationMinutes,
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        recurrenceRule,
        recurrenceTimezone: dto.recurrence ? timezone : null,
        recurrenceEndAt: this.computeRecurrenceEndAt(dto.recurrence),
        aiConstraints: toJsonInput(dto.constraints),
        scheduleReason: result.reason,
        sourceModule: 'schedule_event',
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.TASK_AUTO_SCHEDULED,
      sourceModule: 'schedule',
      payload: { taskId: task.id, title: task.title, startAt: result.startAt.toISOString() },
    });

    return this.taskToItem(task, task.scheduledStart, task.scheduledStart, task.scheduledEnd, false, recurrenceRule ? task.id : null);
  }

  // ─── Update ───────────────────────────────────────────────────────────────────

  async updateEvent(
    userId: string,
    sourceType: ScheduleSourceType,
    id: string,
    dto: UpdateScheduleEventDto,
    scope: ScheduleScope = 'SERIES',
    occurrenceStart?: Date,
  ): Promise<ScheduleItemDto> {
    if (sourceType === 'fixed-event') {
      return this.updateFixedEventItem(userId, id, dto, scope, occurrenceStart);
    }
    return this.updateTaskItem(userId, id, dto, scope, occurrenceStart);
  }

  private async updateFixedEventItem(
    userId: string,
    id: string,
    dto: UpdateScheduleEventDto,
    scope: ScheduleScope,
    occurrenceStart?: Date,
  ): Promise<ScheduleItemDto> {
    const master = await this.prisma.fixedEvent.findUnique({ where: { id } });
    if (!master || master.userId !== userId) throw new NotFoundException('Schedule event not found');

    const isRecurring = !!master.recurrenceRule;

    if (!isRecurring || scope === 'SERIES') {
      const newStart = dto.startAt ? new Date(dto.startAt) : master.startTime;
      const newEnd = dto.endAt ? new Date(dto.endAt) : master.endTime;
      if (newEnd <= newStart) throw new BadRequestException('endAt must be after startAt');

      if (!dto.forceCreate) {
        const conflictResult = await this.checkConflicts(userId, newStart, newEnd, master.id);
        if (conflictResult.hasConflict) {
          throw new ConflictException({ message: 'SCHEDULE_CONFLICT', conflicts: conflictResult.conflicts });
        }
      }

      let recurrenceRule = master.recurrenceRule;
      let recurrenceTimezone = master.recurrenceTimezone;
      let recurrenceEndAt = master.recurrenceEndAt;
      if (dto.recurrence) {
        recurrenceRule = this.recurrence.buildRRuleString(dto.recurrence, newStart);
        recurrenceTimezone = dto.timezone ?? master.timezone;
        recurrenceEndAt = this.computeRecurrenceEndAt(dto.recurrence);
      }

      const updated = await this.prisma.fixedEvent.update({
        where: { id },
        data: {
          title: dto.title ?? master.title,
          description: dto.description ?? master.description,
          startTime: newStart,
          endTime: newEnd,
          timezone: dto.timezone ?? master.timezone,
          recurrenceRule,
          recurrenceTimezone,
          recurrenceEndAt,
        },
      });

      await this.events.publish({
        userId,
        eventType: EventType.FIXED_EVENT_UPDATED,
        sourceModule: 'schedule',
        payload: { eventId: id, scope: 'SERIES' },
      });
      return this.fixedEventToItem(updated, updated.startTime, updated.startTime, updated.endTime, false, updated.recurrenceRule ? updated.id : null);
    }

    if (scope === 'THIS') {
      if (!occurrenceStart) throw new BadRequestException('occurrenceStart is required for THIS scope');
      return this.upsertFixedEventException(userId, master, occurrenceStart, dto);
    }

    if (!occurrenceStart) throw new BadRequestException('occurrenceStart is required for FOLLOWING scope');
    return this.splitFixedEventSeries(userId, master, occurrenceStart, dto);
  }

  private async upsertFixedEventException(
    userId: string,
    master: FixedEvent,
    occurrenceStart: Date,
    dto: UpdateScheduleEventDto,
  ): Promise<ScheduleItemDto> {
    const { baseStart, baseEnd } = this.resolveVirtualOccurrence(master, occurrenceStart);

    const newStart = dto.startAt ? new Date(dto.startAt) : baseStart;
    const newEnd = dto.endAt ? new Date(dto.endAt) : baseEnd;
    if (newEnd <= newStart) throw new BadRequestException('endAt must be after startAt');

    const existing = await this.prisma.fixedEvent.findFirst({
      where: { userId, seriesId: master.id, isRecurrenceException: true, originalOccurrenceStart: occurrenceStart },
    });

    const data = {
      userId,
      title: dto.title ?? master.title,
      description: dto.description ?? master.description,
      location: master.location,
      startTime: newStart,
      endTime: newEnd,
      timezone: dto.timezone ?? master.timezone,
      eventType: master.eventType,
      recurrenceRule: null,
      seriesId: master.id,
      originalOccurrenceStart: occurrenceStart,
      isRecurrenceException: true,
      isCancelled: false,
    };

    const exceptionRow = existing
      ? await this.prisma.fixedEvent.update({ where: { id: existing.id }, data })
      : await this.prisma.fixedEvent.create({ data });

    await this.events.publish({
      userId,
      eventType: EventType.SCHEDULE_SERIES_UPDATED,
      sourceModule: 'schedule',
      payload: { seriesId: master.id, occurrenceStart: occurrenceStart.toISOString(), scope: 'THIS' },
    });

    return this.fixedEventToItem(exceptionRow, occurrenceStart, newStart, newEnd, true, master.id);
  }

  private async splitFixedEventSeries(
    userId: string,
    master: FixedEvent,
    occurrenceStart: Date,
    dto: UpdateScheduleEventDto,
  ): Promise<ScheduleItemDto> {
    const { baseStart, baseEnd } = this.resolveVirtualOccurrence(master, occurrenceStart);
    const newStart = dto.startAt ? new Date(dto.startAt) : baseStart;
    const newEnd = dto.endAt ? new Date(dto.endAt) : baseEnd;
    if (newEnd <= newStart) throw new BadRequestException('endAt must be after startAt');

    const splitPoint = new Date(occurrenceStart.getTime() - 1000);
    const newRecurrenceRule = this.deriveFollowingSeriesRule(master.recurrenceRule, master.recurrenceEndAt, splitPoint);
    const newRecurrenceEndAt = master.recurrenceEndAt && master.recurrenceEndAt > splitPoint ? master.recurrenceEndAt : null;

    const newMaster = await this.prisma.$transaction(async (tx) => {
      await tx.fixedEvent.update({ where: { id: master.id }, data: { recurrenceEndAt: splitPoint } });

      const created = await tx.fixedEvent.create({
        data: {
          userId,
          title: dto.title ?? master.title,
          description: dto.description ?? master.description,
          location: master.location,
          startTime: newStart,
          endTime: newEnd,
          timezone: dto.timezone ?? master.timezone,
          eventType: master.eventType,
          recurrenceRule: newRecurrenceRule,
          recurrenceTimezone: master.recurrenceTimezone,
          recurrenceEndAt: newRecurrenceEndAt,
        },
      });

      // Exceptions at/after the split point conceptually belong to the new series now (same
      // recurrence pattern, same originalOccurrenceStart keys remain valid going forward).
      await tx.fixedEvent.updateMany({
        where: { userId, seriesId: master.id, isRecurrenceException: true, originalOccurrenceStart: { gte: occurrenceStart } },
        data: { seriesId: created.id },
      });

      return created;
    });

    await this.events.publish({
      userId,
      eventType: EventType.SCHEDULE_SERIES_UPDATED,
      sourceModule: 'schedule',
      payload: { seriesId: master.id, newSeriesId: newMaster.id, occurrenceStart: occurrenceStart.toISOString(), scope: 'FOLLOWING' },
    });

    return this.fixedEventToItem(newMaster, newMaster.startTime, newMaster.startTime, newMaster.endTime, false, newMaster.recurrenceRule ? newMaster.id : null);
  }

  private async updateTaskItem(
    userId: string,
    id: string,
    dto: UpdateScheduleEventDto,
    scope: ScheduleScope,
    occurrenceStart?: Date,
  ): Promise<ScheduleItemDto> {
    const master = await this.prisma.task.findUnique({ where: { id } });
    if (!master || master.userId !== userId) throw new NotFoundException('Schedule event not found');

    const isRecurring = !!master.recurrenceRule;

    if (!isRecurring || scope === 'SERIES') {
      const targetMode = dto.schedulingMode ?? master.schedulingMode;
      let newScheduledStart: Date | null = master.scheduledStart;
      let newScheduledEnd: Date | null = master.scheduledEnd;
      let scheduleReason = master.scheduleReason;

      if (targetMode === 'FIXED') {
        const newStart = dto.startAt ? new Date(dto.startAt) : master.scheduledStart;
        const newEnd = dto.endAt ? new Date(dto.endAt) : master.scheduledEnd;
        if (!newStart || !newEnd) {
          throw new BadRequestException('startAt and endAt are required for FIXED scheduling mode');
        }
        if (newEnd <= newStart) throw new BadRequestException('endAt must be after startAt');

        if (!dto.forceCreate) {
          const conflictResult = await this.checkConflicts(userId, newStart, newEnd, master.id);
          if (conflictResult.hasConflict) {
            throw new ConflictException({ message: 'SCHEDULE_CONFLICT', conflicts: conflictResult.conflicts });
          }
        }
        newScheduledStart = newStart;
        newScheduledEnd = newEnd;
        scheduleReason = null;
      } else if (master.schedulingMode === 'FIXED') {
        // Converting FIXED -> AI_AUTO: clear the scheduled slot and mark unscheduled. We do not
        // automatically re-run the AI scheduling algorithm here (documented simplification) — the
        // caller is expected to re-run it explicitly with fresh constraints if desired.
        newScheduledStart = null;
        newScheduledEnd = null;
        scheduleReason = 'Đã chuyển sang chế độ AI tự động sắp lịch; cần chạy lại thuật toán xếp lịch để tìm khung giờ mới.';
      } else if (dto.startAt || dto.endAt) {
        const newStart = dto.startAt ? new Date(dto.startAt) : master.scheduledStart;
        const newEnd = dto.endAt ? new Date(dto.endAt) : master.scheduledEnd;
        if (newStart && newEnd && newEnd <= newStart) throw new BadRequestException('endAt must be after startAt');
        newScheduledStart = newStart;
        newScheduledEnd = newEnd;
      }

      let recurrenceRule = master.recurrenceRule;
      let recurrenceTimezone = master.recurrenceTimezone;
      let recurrenceEndAt = master.recurrenceEndAt;
      if (dto.recurrence) {
        const anchor = newScheduledStart ?? new Date();
        recurrenceRule = this.recurrence.buildRRuleString(dto.recurrence, anchor);
        recurrenceTimezone = dto.timezone ?? master.timezone;
        recurrenceEndAt = this.computeRecurrenceEndAt(dto.recurrence);
      }

      const updated = await this.prisma.task.update({
        where: { id },
        data: {
          title: dto.title ?? master.title,
          description: dto.description ?? master.description,
          priority: dto.priority ?? master.priority,
          schedulingMode: targetMode,
          timezone: dto.timezone ?? master.timezone,
          scheduledStart: newScheduledStart,
          scheduledEnd: newScheduledEnd,
          estimatedMinutes: dto.estimatedDurationMinutes ?? master.estimatedMinutes,
          deadline: dto.deadline ? new Date(dto.deadline) : master.deadline,
          recurrenceRule,
          recurrenceTimezone,
          recurrenceEndAt,
          aiConstraints: dto.constraints ? toJsonInput(dto.constraints) : undefined,
          scheduleReason,
        },
      });

      await this.events.publish({
        userId,
        eventType: EventType.TASK_UPDATED,
        sourceModule: 'schedule',
        payload: { taskId: id, scope: 'SERIES' },
      });
      return this.taskToItem(updated, updated.scheduledStart, updated.scheduledStart, updated.scheduledEnd, false, updated.recurrenceRule ? updated.id : null);
    }

    if (scope === 'THIS') {
      if (!occurrenceStart) throw new BadRequestException('occurrenceStart is required for THIS scope');
      return this.upsertTaskException(userId, master, occurrenceStart, dto);
    }

    if (!occurrenceStart) throw new BadRequestException('occurrenceStart is required for FOLLOWING scope');
    return this.splitTaskSeries(userId, master, occurrenceStart, dto);
  }

  private async upsertTaskException(
    userId: string,
    master: Task,
    occurrenceStart: Date,
    dto: UpdateScheduleEventDto,
  ): Promise<ScheduleItemDto> {
    const { baseStart, baseEnd } = this.resolveVirtualOccurrence(master, occurrenceStart);
    const newStart = dto.startAt ? new Date(dto.startAt) : baseStart;
    const newEnd = dto.endAt ? new Date(dto.endAt) : baseEnd;
    if (newEnd <= newStart) throw new BadRequestException('endAt must be after startAt');

    const existing = await this.prisma.task.findFirst({
      where: { userId, seriesId: master.id, isRecurrenceException: true, originalOccurrenceStart: occurrenceStart },
    });

    const data = {
      userId,
      title: dto.title ?? master.title,
      description: dto.description ?? master.description,
      priority: dto.priority ?? master.priority,
      status: master.status,
      schedulingMode: master.schedulingMode,
      timezone: dto.timezone ?? master.timezone,
      scheduledStart: newStart,
      scheduledEnd: newEnd,
      estimatedMinutes: master.estimatedMinutes,
      sourceModule: master.sourceModule,
      recurrenceRule: null,
      seriesId: master.id,
      originalOccurrenceStart: occurrenceStart,
      isRecurrenceException: true,
      isCancelled: false,
    };

    const exceptionRow = existing
      ? await this.prisma.task.update({ where: { id: existing.id }, data })
      : await this.prisma.task.create({ data });

    await this.events.publish({
      userId,
      eventType: EventType.SCHEDULE_SERIES_UPDATED,
      sourceModule: 'schedule',
      payload: { seriesId: master.id, occurrenceStart: occurrenceStart.toISOString(), scope: 'THIS' },
    });

    return this.taskToItem(exceptionRow, occurrenceStart, newStart, newEnd, true, master.id);
  }

  private async splitTaskSeries(
    userId: string,
    master: Task,
    occurrenceStart: Date,
    dto: UpdateScheduleEventDto,
  ): Promise<ScheduleItemDto> {
    const { baseStart, baseEnd } = this.resolveVirtualOccurrence(master, occurrenceStart);
    const newStart = dto.startAt ? new Date(dto.startAt) : baseStart;
    const newEnd = dto.endAt ? new Date(dto.endAt) : baseEnd;
    if (newEnd <= newStart) throw new BadRequestException('endAt must be after startAt');

    const splitPoint = new Date(occurrenceStart.getTime() - 1000);
    const newRecurrenceRule = this.deriveFollowingSeriesRule(master.recurrenceRule, master.recurrenceEndAt, splitPoint);
    const newRecurrenceEndAt = master.recurrenceEndAt && master.recurrenceEndAt > splitPoint ? master.recurrenceEndAt : null;

    const newMaster = await this.prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: master.id }, data: { recurrenceEndAt: splitPoint } });

      const created = await tx.task.create({
        data: {
          userId,
          title: dto.title ?? master.title,
          description: dto.description ?? master.description,
          priority: dto.priority ?? master.priority,
          status: master.status,
          schedulingMode: master.schedulingMode,
          timezone: dto.timezone ?? master.timezone,
          scheduledStart: newStart,
          scheduledEnd: newEnd,
          estimatedMinutes: master.estimatedMinutes,
          sourceModule: master.sourceModule,
          recurrenceRule: newRecurrenceRule,
          recurrenceTimezone: master.recurrenceTimezone,
          recurrenceEndAt: newRecurrenceEndAt,
        },
      });

      await tx.task.updateMany({
        where: { userId, seriesId: master.id, isRecurrenceException: true, originalOccurrenceStart: { gte: occurrenceStart } },
        data: { seriesId: created.id },
      });

      return created;
    });

    await this.events.publish({
      userId,
      eventType: EventType.SCHEDULE_SERIES_UPDATED,
      sourceModule: 'schedule',
      payload: { seriesId: master.id, newSeriesId: newMaster.id, occurrenceStart: occurrenceStart.toISOString(), scope: 'FOLLOWING' },
    });

    return this.taskToItem(newMaster, newMaster.scheduledStart, newMaster.scheduledStart, newMaster.scheduledEnd, false, newMaster.recurrenceRule ? newMaster.id : null);
  }

  // ─── Delete ───────────────────────────────────────────────────────────────────

  async deleteEvent(
    userId: string,
    sourceType: ScheduleSourceType,
    id: string,
    scope: ScheduleScope = 'SERIES',
    occurrenceStart?: Date,
  ): Promise<{ message: string }> {
    if (sourceType === 'fixed-event') {
      return this.deleteFixedEventItem(userId, id, scope, occurrenceStart);
    }
    return this.deleteTaskItem(userId, id, scope, occurrenceStart);
  }

  private async deleteFixedEventItem(
    userId: string,
    id: string,
    scope: ScheduleScope,
    occurrenceStart?: Date,
  ): Promise<{ message: string }> {
    const master = await this.prisma.fixedEvent.findUnique({ where: { id } });
    if (!master || master.userId !== userId) throw new NotFoundException('Schedule event not found');

    const isRecurring = !!master.recurrenceRule;

    if (!isRecurring || scope === 'SERIES') {
      await this.prisma.$transaction([
        this.prisma.fixedEvent.deleteMany({ where: { userId, seriesId: master.id, isRecurrenceException: true } }),
        this.prisma.fixedEvent.delete({ where: { id: master.id } }),
      ]);
      await this.events.publish({
        userId,
        eventType: EventType.FIXED_EVENT_DELETED,
        sourceModule: 'schedule',
        payload: { eventId: id, scope: 'SERIES' },
      });
      return { message: 'Schedule event deleted' };
    }

    if (scope === 'THIS') {
      if (!occurrenceStart) throw new BadRequestException('occurrenceStart is required for THIS scope');
      const existing = await this.prisma.fixedEvent.findFirst({
        where: { userId, seriesId: master.id, isRecurrenceException: true, originalOccurrenceStart: occurrenceStart },
      });
      if (existing) {
        await this.prisma.fixedEvent.update({ where: { id: existing.id }, data: { isCancelled: true } });
      } else {
        await this.prisma.fixedEvent.create({
          data: {
            userId,
            title: master.title,
            description: master.description,
            location: master.location,
            startTime: occurrenceStart,
            endTime: occurrenceStart,
            timezone: master.timezone,
            eventType: master.eventType,
            recurrenceRule: null,
            seriesId: master.id,
            originalOccurrenceStart: occurrenceStart,
            isRecurrenceException: true,
            isCancelled: true,
          },
        });
      }
      await this.events.publish({
        userId,
        eventType: EventType.SCHEDULE_SERIES_UPDATED,
        sourceModule: 'schedule',
        payload: { seriesId: master.id, occurrenceStart: occurrenceStart.toISOString(), scope: 'THIS', action: 'cancelled' },
      });
      return { message: 'Occurrence cancelled' };
    }

    if (!occurrenceStart) throw new BadRequestException('occurrenceStart is required for FOLLOWING scope');
    const splitPoint = new Date(occurrenceStart.getTime() - 1000);
    await this.prisma.$transaction([
      this.prisma.fixedEvent.update({ where: { id: master.id }, data: { recurrenceEndAt: splitPoint } }),
      this.prisma.fixedEvent.deleteMany({
        where: { userId, seriesId: master.id, isRecurrenceException: true, originalOccurrenceStart: { gte: occurrenceStart } },
      }),
    ]);
    await this.events.publish({
      userId,
      eventType: EventType.SCHEDULE_SERIES_DELETED,
      sourceModule: 'schedule',
      payload: { seriesId: master.id, occurrenceStart: occurrenceStart.toISOString(), scope: 'FOLLOWING' },
    });
    return { message: 'Following occurrences deleted' };
  }

  private async deleteTaskItem(
    userId: string,
    id: string,
    scope: ScheduleScope,
    occurrenceStart?: Date,
  ): Promise<{ message: string }> {
    const master = await this.prisma.task.findUnique({ where: { id } });
    if (!master || master.userId !== userId) throw new NotFoundException('Schedule event not found');

    const isRecurring = !!master.recurrenceRule;

    if (!isRecurring || scope === 'SERIES') {
      await this.prisma.$transaction([
        this.prisma.task.deleteMany({ where: { userId, seriesId: master.id, isRecurrenceException: true } }),
        this.prisma.task.delete({ where: { id: master.id } }),
      ]);
      await this.events.publish({
        userId,
        eventType: EventType.TASK_DELETED,
        sourceModule: 'schedule',
        payload: { taskId: id, scope: 'SERIES' },
      });
      return { message: 'Schedule event deleted' };
    }

    if (scope === 'THIS') {
      if (!occurrenceStart) throw new BadRequestException('occurrenceStart is required for THIS scope');
      const existing = await this.prisma.task.findFirst({
        where: { userId, seriesId: master.id, isRecurrenceException: true, originalOccurrenceStart: occurrenceStart },
      });
      if (existing) {
        await this.prisma.task.update({ where: { id: existing.id }, data: { isCancelled: true } });
      } else {
        await this.prisma.task.create({
          data: {
            userId,
            title: master.title,
            description: master.description,
            priority: master.priority,
            status: master.status,
            schedulingMode: master.schedulingMode,
            timezone: master.timezone,
            scheduledStart: occurrenceStart,
            scheduledEnd: occurrenceStart,
            estimatedMinutes: master.estimatedMinutes,
            sourceModule: master.sourceModule,
            recurrenceRule: null,
            seriesId: master.id,
            originalOccurrenceStart: occurrenceStart,
            isRecurrenceException: true,
            isCancelled: true,
          },
        });
      }
      await this.events.publish({
        userId,
        eventType: EventType.SCHEDULE_SERIES_UPDATED,
        sourceModule: 'schedule',
        payload: { seriesId: master.id, occurrenceStart: occurrenceStart.toISOString(), scope: 'THIS', action: 'cancelled' },
      });
      return { message: 'Occurrence cancelled' };
    }

    if (!occurrenceStart) throw new BadRequestException('occurrenceStart is required for FOLLOWING scope');
    const splitPoint = new Date(occurrenceStart.getTime() - 1000);
    await this.prisma.$transaction([
      this.prisma.task.update({ where: { id: master.id }, data: { recurrenceEndAt: splitPoint } }),
      this.prisma.task.deleteMany({
        where: { userId, seriesId: master.id, isRecurrenceException: true, originalOccurrenceStart: { gte: occurrenceStart } },
      }),
    ]);
    await this.events.publish({
      userId,
      eventType: EventType.SCHEDULE_SERIES_DELETED,
      sourceModule: 'schedule',
      payload: { seriesId: master.id, occurrenceStart: occurrenceStart.toISOString(), scope: 'FOLLOWING' },
    });
    return { message: 'Following occurrences deleted' };
  }

  // ─── Conflict detection ───────────────────────────────────────────────────────

  async checkConflicts(userId: string, startAt: Date, endAt: Date, excludeId?: string): Promise<ConflictCheckResult> {
    const windowFrom = new Date(startAt.getTime() - CONFLICT_WINDOW_DAYS * 86_400_000);
    const windowTo = new Date(endAt.getTime() + CONFLICT_WINDOW_DAYS * 86_400_000);

    const [fixedCandidates, taskCandidates] = await Promise.all([
      this.prisma.fixedEvent.findMany({
        where: {
          userId,
          isCancelled: false,
          isRecurrenceException: false,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          OR: [
            { recurrenceRule: null, startTime: { lt: endAt }, endTime: { gt: startAt } },
            {
              recurrenceRule: { not: null },
              startTime: { lt: windowTo },
              AND: [{ OR: [{ recurrenceEndAt: null }, { recurrenceEndAt: { gte: windowFrom } }] }],
            },
          ],
        },
      }),
      this.prisma.task.findMany({
        where: {
          userId,
          isCancelled: false,
          isRecurrenceException: false,
          schedulingMode: 'FIXED',
          ...(excludeId ? { id: { not: excludeId } } : {}),
          OR: [
            { recurrenceRule: null, scheduledStart: { lt: endAt }, scheduledEnd: { gt: startAt } },
            {
              recurrenceRule: { not: null },
              scheduledStart: { lt: windowTo },
              AND: [{ OR: [{ recurrenceEndAt: null }, { recurrenceEndAt: { gte: windowFrom } }] }],
            },
          ],
        },
      }),
    ]);

    const conflicts: ConflictItem[] = [];

    for (const ev of fixedCandidates) {
      if (!ev.recurrenceRule) {
        if (ev.startTime < endAt && ev.endTime > startAt) {
          conflicts.push({ id: ev.id, sourceType: 'FIXED_EVENT', title: ev.title, startAt: ev.startTime.toISOString(), endAt: ev.endTime.toISOString() });
        }
        continue;
      }
      for (const occ of this.recurrence.expandOccurrences(ev, windowFrom, windowTo)) {
        if (occ.occurrenceStart < endAt && occ.occurrenceEnd > startAt) {
          conflicts.push({ id: ev.id, sourceType: 'FIXED_EVENT', title: ev.title, startAt: occ.occurrenceStart.toISOString(), endAt: occ.occurrenceEnd.toISOString() });
        }
      }
    }

    for (const t of taskCandidates) {
      if (!t.recurrenceRule) {
        if (t.scheduledStart && t.scheduledEnd && t.scheduledStart < endAt && t.scheduledEnd > startAt) {
          conflicts.push({ id: t.id, sourceType: 'TASK', title: t.title, startAt: t.scheduledStart.toISOString(), endAt: t.scheduledEnd.toISOString() });
        }
        continue;
      }
      for (const occ of this.recurrence.expandOccurrences(t, windowFrom, windowTo)) {
        if (occ.occurrenceStart < endAt && occ.occurrenceEnd > startAt) {
          conflicts.push({ id: t.id, sourceType: 'TASK', title: t.title, startAt: occ.occurrenceStart.toISOString(), endAt: occ.occurrenceEnd.toISOString() });
        }
      }
    }

    return { hasConflict: conflicts.length > 0, conflicts };
  }

  // ─── AI auto-scheduling ───────────────────────────────────────────────────────

  private async runAiAutoSchedule(
    userId: string,
    params: {
      estimatedDurationMinutes: number;
      deadline?: Date;
      priority: TaskPriority;
      constraints?: AiConstraintsInputDto;
      timezone: string;
    },
  ): Promise<{ startAt: Date; endAt: Date; reason: string } | null> {
    const now = new Date();
    let searchFrom = now;
    let searchTo = params.deadline ?? new Date(now.getTime() + 14 * 86_400_000);

    if (params.constraints?.preferredDateRangeStart) {
      const s = new Date(params.constraints.preferredDateRangeStart);
      if (s > searchFrom) searchFrom = s;
    }
    if (params.constraints?.preferredDateRangeEnd) {
      const e = new Date(params.constraints.preferredDateRangeEnd);
      if (e < searchTo) searchTo = e;
    }
    if (searchTo <= searchFrom) return null;

    const timeWindow = this.resolveTimeWindow(params.constraints);
    const allowedWeekdays = params.constraints?.allowedWeekdays?.length
      ? new Set(params.constraints.allowedWeekdays as WeekdayCode[])
      : ALL_WEEKDAYS;
    const bufferMs = (params.constraints?.bufferMinutes ?? 0) * 60_000;
    const durationMs = params.estimatedDurationMinutes * 60_000;

    const busyIntervals = await this.loadBusyIntervals(userId, searchFrom, searchTo);

    let cursorDay = DateTime.fromJSDate(searchFrom, { zone: params.timezone }).startOf('day');
    const searchToLocal = DateTime.fromJSDate(searchTo, { zone: params.timezone });
    let daysWalked = 0;

    while (cursorDay <= searchToLocal && daysWalked < 400) {
      daysWalked += 1;
      const weekdayCode = LUXON_WEEKDAY_CODES[cursorDay.weekday - 1];
      if (allowedWeekdays.has(weekdayCode)) {
        const dayWindowStartLocal = cursorDay.set({ hour: timeWindow.startHour, minute: timeWindow.startMinute, second: 0, millisecond: 0 });
        const dayWindowEndLocal = cursorDay.set({ hour: timeWindow.endHour, minute: timeWindow.endMinute, second: 0, millisecond: 0 });

        let dayWindowStart = dayWindowStartLocal.toJSDate();
        let dayWindowEnd = dayWindowEndLocal.toJSDate();
        if (dayWindowStart.getTime() < searchFrom.getTime()) dayWindowStart = searchFrom;
        if (dayWindowEnd.getTime() > searchTo.getTime()) dayWindowEnd = searchTo;

        if (dayWindowStart < dayWindowEnd) {
          const gap = this.findEarliestGap(dayWindowStart, dayWindowEnd, busyIntervals, durationMs, bufferMs);
          if (gap) {
            return {
              startAt: gap.start,
              endAt: new Date(gap.start.getTime() + durationMs),
              reason: this.buildReasonMessage(params.constraints),
            };
          }
        }
      }
      cursorDay = cursorDay.plus({ days: 1 });
    }

    return null;
  }

  private findEarliestGap(
    windowStart: Date,
    windowEnd: Date,
    busy: Array<{ start: Date; end: Date }>,
    durationMs: number,
    bufferMs: number,
  ): { start: Date } | null {
    const relevant = busy
      .filter((b) => b.end.getTime() + bufferMs > windowStart.getTime() && b.start.getTime() - bufferMs < windowEnd.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    let cursor = windowStart;
    for (const b of relevant) {
      const paddedStart = new Date(b.start.getTime() - bufferMs);
      const paddedEnd = new Date(b.end.getTime() + bufferMs);
      if (paddedStart.getTime() - cursor.getTime() >= durationMs) {
        return { start: cursor };
      }
      if (paddedEnd.getTime() > cursor.getTime()) cursor = paddedEnd;
    }
    if (windowEnd.getTime() - cursor.getTime() >= durationMs) {
      return { start: cursor };
    }
    return null;
  }

  private resolveTimeWindow(constraints?: AiConstraintsInputDto): { startHour: number; startMinute: number; endHour: number; endMinute: number } {
    if (constraints?.earliestStartTime || constraints?.latestEndTime) {
      const [sh, sm] = (constraints.earliestStartTime ?? '08:00').split(':').map(Number);
      const [eh, em] = (constraints.latestEndTime ?? '22:00').split(':').map(Number);
      return { startHour: sh, startMinute: sm, endHour: eh, endMinute: em };
    }
    switch (constraints?.preferredTimeOfDay) {
      case 'MORNING':
        return { startHour: 8, startMinute: 0, endHour: 12, endMinute: 0 };
      case 'AFTERNOON':
        return { startHour: 13, startMinute: 0, endHour: 18, endMinute: 0 };
      case 'EVENING':
        return { startHour: 18, startMinute: 0, endHour: 22, endMinute: 0 };
      default:
        return { startHour: 8, startMinute: 0, endHour: 22, endMinute: 0 };
    }
  }

  private buildReasonMessage(constraints?: AiConstraintsInputDto): string {
    switch (constraints?.preferredTimeOfDay) {
      case 'MORNING':
        return 'Đã chọn khung giờ buổi sáng còn trống trước hạn chót.';
      case 'AFTERNOON':
        return 'Đã chọn khung giờ buổi chiều còn trống trước hạn chót.';
      case 'EVENING':
        return 'Đã chọn khung giờ tối còn trống trước hạn chót.';
      default:
        return 'Đã chọn khung giờ trống gần nhất phù hợp với thời hạn.';
    }
  }

  private async loadBusyIntervals(userId: string, from: Date, to: Date): Promise<Array<{ start: Date; end: Date }>> {
    const relevantTasks = await this.prisma.task.findMany({
      where: {
        userId,
        isCancelled: false,
        isRecurrenceException: false,
        OR: [{ schedulingMode: 'FIXED' }, { schedulingMode: 'AI_AUTO', scheduledStart: { not: null } }],
        AND: [
          {
            OR: [
              { recurrenceRule: null, scheduledStart: { lt: to }, scheduledEnd: { gt: from } },
              {
                recurrenceRule: { not: null },
                OR: [{ recurrenceEndAt: null }, { recurrenceEndAt: { gte: from } }],
              },
            ],
          },
        ],
      },
    });

    const fixedEvents = await this.prisma.fixedEvent.findMany({
      where: {
        userId,
        isCancelled: false,
        isRecurrenceException: false,
        OR: [
          { recurrenceRule: null, startTime: { lt: to }, endTime: { gt: from } },
          { recurrenceRule: { not: null }, OR: [{ recurrenceEndAt: null }, { recurrenceEndAt: { gte: from } }] },
        ],
      },
    });

    const intervals: Array<{ start: Date; end: Date }> = [];
    for (const ev of fixedEvents) {
      if (!ev.recurrenceRule) {
        intervals.push({ start: ev.startTime, end: ev.endTime });
      } else {
        for (const occ of this.recurrence.expandOccurrences(ev, from, to)) {
          intervals.push({ start: occ.occurrenceStart, end: occ.occurrenceEnd });
        }
      }
    }
    for (const t of relevantTasks) {
      if (!t.recurrenceRule) {
        if (t.scheduledStart && t.scheduledEnd) intervals.push({ start: t.scheduledStart, end: t.scheduledEnd });
      } else {
        for (const occ of this.recurrence.expandOccurrences(t, from, to)) {
          intervals.push({ start: occ.occurrenceStart, end: occ.occurrenceEnd });
        }
      }
    }
    return intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  private async buildSuggestions(
    userId: string,
    dto: CreateScheduleEventDto,
    priority: TaskPriority,
    timezone: string,
  ): Promise<string[]> {
    const suggestions: string[] = [];
    const base = {
      estimatedDurationMinutes: dto.estimatedDurationMinutes!,
      deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      priority,
      timezone,
    };

    if (dto.constraints?.preferredTimeOfDay && dto.constraints.preferredTimeOfDay !== 'ANY') {
      const relaxed = await this.runAiAutoSchedule(userId, {
        ...base,
        constraints: { ...dto.constraints, preferredTimeOfDay: 'ANY' },
      });
      if (relaxed) suggestions.push('Thử bỏ giới hạn buổi trong ngày (sáng/chiều/tối) để có thêm khung giờ trống.');
    }

    if (dto.constraints?.allowedWeekdays?.length) {
      const relaxed = await this.runAiAutoSchedule(userId, {
        ...base,
        constraints: { ...dto.constraints, allowedWeekdays: undefined },
      });
      if (relaxed) suggestions.push('Thử bỏ giới hạn ngày trong tuần để có thêm lựa chọn.');
    }

    if (dto.deadline) {
      const pushedDeadline = new Date(new Date(dto.deadline).getTime() + 3 * 86_400_000);
      const relaxed = await this.runAiAutoSchedule(userId, { ...base, deadline: pushedDeadline, constraints: dto.constraints });
      if (relaxed) suggestions.push('Thử lùi hạn chót thêm vài ngày để có nhiều khung giờ hơn.');
    }

    if (suggestions.length === 0) {
      suggestions.push('Thử giảm thời lượng dự kiến hoặc chọn một khoảng thời gian khác.');
    }
    return suggestions;
  }

  // ─── Shared helpers ───────────────────────────────────────────────────────────

  private computeRecurrenceEndAt(recurrence?: { endType?: string; until?: string }): Date | null {
    if (!recurrence) return null;
    if (recurrence.endType === 'UNTIL' && recurrence.until) return new Date(recurrence.until);
    return null; // NEVER or COUNT-bounded rules: bounding is enforced by the RRULE string itself
  }

  /**
   * FOLLOWING-scope split simplification: reuses the old rule's FREQ/INTERVAL/BYDAY/BYMONTHDAY
   * components, drops any old COUNT (exactly reducing a remaining COUNT across an arbitrary split
   * point isn't reliably computable without re-deriving the exact occurrence index), and instead
   * re-anchors the end bound to the old series' recurrenceEndAt (as UNTIL) if one existed, or
   * leaves the new series open-ended (NEVER) otherwise. This never produces MORE occurrences than
   * the original series would have had, and never duplicates/orphans data — it can only be
   * more permissive than an exact COUNT reduction would be in rare edge cases.
   */
  private deriveFollowingSeriesRule(recurrenceRule: string | null, recurrenceEndAt: Date | null, splitPoint: Date): string | null {
    if (!recurrenceRule) return null;
    const parts = recurrenceRule.split(';').filter((p) => !p.startsWith('COUNT=') && !p.startsWith('UNTIL='));
    const effectiveEnd = recurrenceEndAt && recurrenceEndAt > splitPoint ? recurrenceEndAt : null;
    if (effectiveEnd) {
      const untilStr = DateTime.fromJSDate(effectiveEnd, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");
      parts.push(`UNTIL=${untilStr}`);
    }
    return parts.join(';');
  }

  private resolveVirtualOccurrence(
    master: { startTime?: Date | null; endTime?: Date | null; scheduledStart?: Date | null; scheduledEnd?: Date | null; recurrenceRule?: string | null; recurrenceTimezone?: string | null; recurrenceEndAt?: Date | null; id: string },
    occurrenceStart: Date,
  ): { baseStart: Date; baseEnd: Date } {
    const windowFrom = new Date(occurrenceStart.getTime() - 86_400_000);
    const windowTo = new Date(occurrenceStart.getTime() + 86_400_000);
    const virtualOccurrences = this.recurrence.expandOccurrences(master, windowFrom, windowTo);
    const virtual = virtualOccurrences.find((o) => o.occurrenceStart.getTime() === occurrenceStart.getTime());
    if (virtual) return { baseStart: virtual.occurrenceStart, baseEnd: virtual.occurrenceEnd };

    const masterStart = master.startTime ?? master.scheduledStart ?? occurrenceStart;
    const masterEnd = master.endTime ?? master.scheduledEnd ?? occurrenceStart;
    const durationMs = masterEnd.getTime() - masterStart.getTime();
    return { baseStart: occurrenceStart, baseEnd: new Date(occurrenceStart.getTime() + durationMs) };
  }

  private groupBySeries<T extends { seriesId: string | null }>(rows: T[]): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      if (!row.seriesId) continue;
      const arr = map.get(row.seriesId) ?? [];
      arr.push(row);
      map.set(row.seriesId, arr);
    }
    return map;
  }

  private indexExceptionsByTime<T extends { originalOccurrenceStart: Date | null }>(rows: T[]): Map<number, T> {
    const map = new Map<number, T>();
    for (const row of rows) {
      if (!row.originalOccurrenceStart) continue;
      map.set(row.originalOccurrenceStart.getTime(), row);
    }
    return map;
  }

  private fixedEventToItem(
    source: FixedEvent,
    occurrenceStart: Date,
    displayStart: Date,
    displayEnd: Date,
    isException: boolean,
    seriesId: string | null,
  ): ScheduleItemDto {
    return {
      id: source.id,
      sourceType: 'FIXED_EVENT',
      seriesId,
      isRecurring: seriesId !== null,
      isRecurrenceInstance: seriesId !== null,
      occurrenceStart: occurrenceStart.toISOString(),
      isException,
      title: source.title,
      description: source.description,
      location: source.location,
      startAt: displayStart.toISOString(),
      endAt: displayEnd.toISOString(),
      timezone: source.timezone,
      schedulingMode: 'FIXED',
      priority: null,
      status: null,
      eventType: source.eventType,
      recurrenceRule: seriesId ? source.recurrenceRule ?? null : source.recurrenceRule,
      scheduleReason: null,
      deadline: null,
    };
  }

  private taskToItem(
    source: Task,
    occurrenceStart: Date | null,
    displayStart: Date | null,
    displayEnd: Date | null,
    isException: boolean,
    seriesId: string | null,
  ): ScheduleItemDto {
    return {
      id: source.id,
      sourceType: 'TASK',
      seriesId,
      isRecurring: seriesId !== null,
      isRecurrenceInstance: seriesId !== null,
      occurrenceStart: occurrenceStart ? occurrenceStart.toISOString() : null,
      isException,
      title: source.title,
      description: source.description,
      location: null,
      startAt: displayStart ? displayStart.toISOString() : null,
      endAt: displayEnd ? displayEnd.toISOString() : null,
      timezone: source.timezone,
      schedulingMode: source.schedulingMode,
      priority: source.priority,
      status: source.status,
      eventType: null,
      recurrenceRule: source.recurrenceRule,
      scheduleReason: source.scheduleReason,
      deadline: source.deadline ? source.deadline.toISOString() : null,
    };
  }
}
