import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Task } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { CreateFixedEventDto, UpdateFixedEventDto } from './dto/create-fixed-event.dto.js';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto.js';
import { AutoPlanDto } from './dto/auto-plan.dto.js';

const PRIORITY_ORDER: Record<string, number> = {
  URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
};

function dateRange(dateStr: string): { gte: Date; lt: Date } {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return { gte: d, lt: next };
}

@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  // ─── Fixed Events ─────────────────────────────────────────────────────────────

  async createFixedEvent(userId: string, dto: CreateFixedEventDto) {
    const ev = await this.prisma.fixedEvent.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        location: dto.location,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        timezone: dto.timezone ?? 'Asia/Taipei',
        recurrenceRule: dto.recurrenceRule,
        eventType: dto.eventType ?? 'GENERAL',
      },
    });
    await this.events.publish({
      userId,
      eventType: EventType.FIXED_EVENT_CREATED,
      sourceModule: 'schedule',
      payload: { eventId: ev.id, title: ev.title },
    });
    return ev;
  }

  async findAllFixedEvents(userId: string) {
    return this.prisma.fixedEvent.findMany({
      where: { userId },
      orderBy: { startTime: 'asc' },
    });
  }

  async findFixedEvent(userId: string, id: string) {
    const ev = await this.prisma.fixedEvent.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException('Fixed event not found');
    if (ev.userId !== userId) throw new ForbiddenException();
    return ev;
  }

  async updateFixedEvent(userId: string, id: string, dto: UpdateFixedEventDto) {
    const ev = await this.findFixedEvent(userId, id);
    const updated = await this.prisma.fixedEvent.update({
      where: { id },
      data: {
        ...dto,
        startTime: dto.startTime ? new Date(dto.startTime) : ev.startTime,
        endTime: dto.endTime ? new Date(dto.endTime) : ev.endTime,
      },
    });
    await this.events.publish({
      userId,
      eventType: EventType.FIXED_EVENT_UPDATED,
      sourceModule: 'schedule',
      payload: { eventId: id },
    });
    return updated;
  }

  async deleteFixedEvent(userId: string, id: string) {
    await this.findFixedEvent(userId, id);
    await this.prisma.fixedEvent.delete({ where: { id } });
    await this.events.publish({
      userId,
      eventType: EventType.FIXED_EVENT_DELETED,
      sourceModule: 'schedule',
      payload: { eventId: id },
    });
    return { message: 'Fixed event deleted' };
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────────

  async createTask(userId: string, dto: CreateTaskDto) {
    const task = await this.prisma.task.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? 'MEDIUM',
        deadline: dto.deadline ? new Date(dto.deadline) : null,
        estimatedMinutes: dto.estimatedMinutes,
        scheduledStart: null,
        scheduledEnd: null,
        sourceModule: dto.sourceModule ?? 'manual',
        sourceEntityId: dto.sourceEntityId,
      },
    });
    await this.events.publish({
      userId,
      eventType: EventType.TASK_CREATED,
      sourceModule: 'schedule',
      payload: { taskId: task.id, title: task.title, priority: task.priority },
    });
    return task;
  }

  async findAllTasks(userId: string) {
    await this.markOverdueTasks(userId);
    return this.prisma.task.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { deadline: 'asc' }],
    });
  }

  async findTask(userId: string, id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.userId !== userId) throw new ForbiddenException();
    return task;
  }

  async updateTask(userId: string, id: string, dto: UpdateTaskDto) {
    await this.findTask(userId, id);
    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        ...dto,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        scheduledStart: dto.scheduledStart ? new Date(dto.scheduledStart) : undefined,
        scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : undefined,
      },
    });
    await this.events.publish({
      userId,
      eventType: EventType.TASK_UPDATED,
      sourceModule: 'schedule',
      payload: { taskId: id, status: updated.status },
    });
    return updated;
  }

  async deleteTask(userId: string, id: string) {
    await this.findTask(userId, id);
    await this.prisma.task.delete({ where: { id } });
    await this.events.publish({
      userId,
      eventType: EventType.TASK_DELETED,
      sourceModule: 'schedule',
      payload: { taskId: id },
    });
    return { message: 'Task deleted' };
  }

  async completeTask(userId: string, id: string) {
    await this.findTask(userId, id);
    const updated = await this.prisma.task.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });
    await this.events.publish({
      userId,
      eventType: EventType.TASK_COMPLETED,
      sourceModule: 'schedule',
      payload: { taskId: id },
    });
    return updated;
  }

  // ─── Auto-plan ────────────────────────────────────────────────────────────────

  async autoSchedule(userId: string, dto: AutoPlanDto) {
    const range = dateRange(dto.date);
    const startHour = dto.startHour ?? 8;
    const endHour = dto.endHour ?? 22;

    const [fixedEvents, pendingTasks] = await Promise.all([
      this.prisma.fixedEvent.findMany({
        where: { userId, startTime: { gte: range.gte, lt: range.lt } },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { userId, status: { in: ['TODO', 'IN_PROGRESS'] } },
        orderBy: [{ priority: 'asc' }, { deadline: 'asc' }],
      }),
    ]);

    const dayStart = new Date(range.gte);
    dayStart.setHours(startHour, 0, 0, 0);
    const dayEnd = new Date(range.gte);
    dayEnd.setHours(endHour, 0, 0, 0);

    type Block = { start: Date; end: Date };
    const blockedSlots: Block[] = fixedEvents.map((e) => ({ start: e.startTime, end: e.endTime }));

    const sortedTasks = [...pendingTasks].sort((a, b) => {
      const pDiff = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2);
      if (pDiff !== 0) return pDiff;
      if (a.deadline && b.deadline) return a.deadline.getTime() - b.deadline.getTime();
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

    const scheduledTasks: Task[] = [];
    const unscheduledTasks: Task[] = [];
    let cursor = new Date(dayStart);

    for (const task of sortedTasks) {
      const duration = (task.estimatedMinutes ?? 30) * 60_000;

      // advance cursor past any fixed events
      let moved = true;
      while (moved) {
        moved = false;
        for (const block of blockedSlots) {
          if (cursor >= block.start && cursor < block.end) {
            cursor = new Date(block.end);
            moved = true;
          }
        }
      }

      const slotEnd = new Date(cursor.getTime() + duration);

      // check if slotEnd overlaps any fixed event
      const overlaps = blockedSlots.some(
        (b) => cursor < b.end && slotEnd > b.start,
      );

      if (slotEnd > dayEnd || overlaps) {
        unscheduledTasks.push(task);
        continue;
      }

      const updated = await this.prisma.task.update({
        where: { id: task.id },
        data: { scheduledStart: cursor, scheduledEnd: slotEnd },
      });
      scheduledTasks.push(updated);
      cursor = slotEnd;
    }

    const planJson = { fixedEvents, scheduledTasks, unscheduledTasks };

    const plan = await this.prisma.schedulePlan.create({
      data: {
        userId,
        planDate: range.gte,
        summary: `Đã lên lịch ${scheduledTasks.length} công việc, ${unscheduledTasks.length} chưa được xếp lịch`,
        planJson,
      },
    });

    await this.events.publish({
      userId,
      eventType: EventType.SCHEDULE_PLAN_GENERATED,
      sourceModule: 'schedule',
      payload: { planId: plan.id, date: dto.date, scheduled: scheduledTasks.length, unscheduled: unscheduledTasks.length },
    });

    return { plan, fixedEvents, scheduledTasks, unscheduledTasks, summary: plan.summary };
  }

  async reschedule(userId: string, dto: AutoPlanDto) {
    // reset scheduledStart/End for unscheduled/todo tasks on that date first
    const range = dateRange(dto.date);
    await this.prisma.task.updateMany({
      where: {
        userId,
        status: { in: ['TODO', 'IN_PROGRESS'] },
        scheduledStart: { gte: range.gte, lt: range.lt },
      },
      data: { scheduledStart: null, scheduledEnd: null },
    });
    return this.autoSchedule(userId, dto);
  }

  // ─── Daily Plan ───────────────────────────────────────────────────────────────

  async getDailyPlan(userId: string, date: string) {
    const range = dateRange(date);

    const [fixedEvents, scheduledTasks, unscheduledTasks] = await Promise.all([
      this.prisma.fixedEvent.findMany({
        where: { userId, startTime: range },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { userId, scheduledStart: range, status: { notIn: ['CANCELLED'] } },
        orderBy: { scheduledStart: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { userId, scheduledStart: null, status: { in: ['TODO', 'IN_PROGRESS'] } },
        orderBy: [{ priority: 'asc' }, { deadline: 'asc' }],
      }),
    ]);

    return {
      date,
      fixedEvents,
      scheduledTasks,
      unscheduledTasks,
      summary: `${fixedEvents.length} sự kiện cố định, ${scheduledTasks.length} công việc đã lên lịch, ${unscheduledTasks.length} chưa lên lịch`,
    };
  }

  // ─── Conflict Detection ───────────────────────────────────────────────────────

  async getConflicts(userId: string, date: string) {
    const range = dateRange(date);

    const [fixedEvents, tasks] = await Promise.all([
      this.prisma.fixedEvent.findMany({
        where: { userId, startTime: range },
        orderBy: { startTime: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { userId, scheduledStart: range, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
        orderBy: { scheduledStart: 'asc' },
      }),
    ]);

    type ConflictItem = { type: string; a: unknown; b: unknown; message: string };
    const conflicts: ConflictItem[] = [];

    // Check fixed event overlaps
    for (let i = 0; i < fixedEvents.length; i++) {
      for (let j = i + 1; j < fixedEvents.length; j++) {
        const a = fixedEvents[i];
        const b = fixedEvents[j];
        if (a.startTime < b.endTime && a.endTime > b.startTime) {
          conflicts.push({ type: 'FIXED_OVERLAP', a, b, message: `"${a.title}" và "${b.title}" bị trùng giờ` });
        }
      }
    }

    // Check task overlaps
    const scheduledTasks = tasks.filter((t) => t.scheduledStart && t.scheduledEnd);
    for (let i = 0; i < scheduledTasks.length; i++) {
      for (let j = i + 1; j < scheduledTasks.length; j++) {
        const a = scheduledTasks[i];
        const b = scheduledTasks[j];
        if (a.scheduledStart! < b.scheduledEnd! && a.scheduledEnd! > b.scheduledStart!) {
          conflicts.push({ type: 'TASK_OVERLAP', a, b, message: `"${a.title}" và "${b.title}" bị trùng giờ` });
        }
      }
    }

    // Check task vs fixed event overlap
    for (const task of scheduledTasks) {
      for (const ev of fixedEvents) {
        if (task.scheduledStart! < ev.endTime && task.scheduledEnd! > ev.startTime) {
          conflicts.push({ type: 'TASK_EVENT_OVERLAP', a: task, b: ev, message: `Công việc "${task.title}" trùng với sự kiện "${ev.title}"` });
        }
      }
    }

    return { date, conflictCount: conflicts.length, conflicts };
  }

  // ─── Productivity Insights ────────────────────────────────────────────────────

  async getProductivityInsights(userId: string) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [completedThisWeek, overdueTasks, totalTasks] = await Promise.all([
      this.prisma.task.count({
        where: { userId, status: 'COMPLETED', updatedAt: { gte: oneWeekAgo } },
      }),
      this.prisma.task.count({
        where: { userId, status: 'OVERDUE' },
      }),
      this.prisma.task.count({
        where: { userId, status: { notIn: ['CANCELLED'] } },
      }),
    ]);

    const completedTotal = await this.prisma.task.count({ where: { userId, status: 'COMPLETED' } });
    const completionRate = totalTasks > 0 ? Math.round((completedTotal / totalTasks) * 100) : 0;

    let suggestion = 'Tiếp tục duy trì hiệu suất tốt!';
    if (overdueTasks > 5) suggestion = 'Bạn có nhiều công việc quá hạn. Hãy ưu tiên xử lý chúng trước.';
    else if (completionRate < 40) suggestion = 'Thử chia nhỏ công việc lớn thành các bước nhỏ hơn để hoàn thành dễ hơn.';
    else if (completedThisWeek >= 10) suggestion = 'Tuần này rất hiệu quả! Bạn đã hoàn thành nhiều công việc.';

    return {
      completedTasksThisWeek: completedThisWeek,
      overdueTasks,
      completionRate,
      totalTasks,
      suggestion,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async markOverdueTasks(userId: string): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.task.updateMany({
      where: {
        userId,
        status: 'TODO',
        deadline: { lt: now },
      },
      data: { status: 'OVERDUE' },
    });
    if (updated.count > 0) {
      await this.events.publish({
        userId,
        eventType: EventType.TASK_OVERDUE,
        sourceModule: 'schedule',
        payload: { count: updated.count },
      });
    }
  }
}
