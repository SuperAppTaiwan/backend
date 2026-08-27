import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService, EventType } from '../events/events.service.js';
import { PushService } from './push.service.js';
import type { UpdateNotificationPreferenceDto } from './dto/notification.dto.js';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly push: PushService,
  ) {}

  // ─── Push Tokens ─────────────────────────────────────────────────────────────

  async registerPushToken(userId: string, token: string, platform: string, deviceId: string) {
    return this.push.registerToken(userId, token, platform, deviceId);
  }

  // ─── Preferences ─────────────────────────────────────────────────────────────

  async getOrCreatePreferences(userId: string) {
    const prefs = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (prefs) return prefs;
    return this.prisma.notificationPreference.create({ data: { userId } });
  }

  async updatePreferences(userId: string, dto: UpdateNotificationPreferenceDto) {
    const prefs = await this.getOrCreatePreferences(userId);
    const updated = await this.prisma.notificationPreference.update({
      where: { id: prefs.id },
      data: {
        taskReminder: dto.taskReminder,
        goalReminder: dto.goalReminder,
        budgetWarning: dto.budgetWarning,
        dailyVocabulary: dto.dailyVocabulary,
        weeklySummary: dto.weeklySummary,
        recurringExpenseReminder: dto.recurringExpenseReminder,
        pushEnabled: dto.pushEnabled,
        emailEnabled: dto.emailEnabled,
        quietHoursStart: dto.quietHoursStart,
        quietHoursEnd: dto.quietHoursEnd,
      },
    });
    await this.events.publish({ userId, eventType: EventType.NOTIFICATION_PREFERENCES_UPDATED, sourceModule: 'notifications', payload: {} });
    return updated;
  }

  // ─── Notifications ────────────────────────────────────────────────────────────

  async createNotification(userId: string, type: NotificationType, title: string, message: string) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, title, message },
    });
    await this.events.publish({ userId, eventType: EventType.NOTIFICATION_CREATED, sourceModule: 'notifications', payload: { id: notification.id, type } });

    // Send push notification if user has push enabled and not in quiet hours
    const prefs = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (prefs?.pushEnabled) {
      const inQuiet = await this.push.isInQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd);
      if (!inQuiet) {
        this.push.sendPush(userId, title, message, { notificationId: notification.id, type }).catch(() => {});
      }
    }

    return notification;
  }

  async findAll(userId: string, onlyUnread = false) {
    return this.prisma.notification.findMany({
      where: { userId, ...(onlyUnread ? { status: 'UNREAD' } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async countUnread(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { userId, status: 'UNREAD' } });
    return { count };
  }

  async markRead(userId: string, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.userId !== userId) throw new ForbiddenException();
    const updated = await this.prisma.notification.update({ where: { id }, data: { status: 'READ' } });
    await this.events.publish({ userId, eventType: EventType.NOTIFICATION_READ, sourceModule: 'notifications', payload: { id } });
    return updated;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({ where: { userId, status: 'UNREAD' }, data: { status: 'READ' } });
    return { updated: result.count };
  }

  async archive(userId: string, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.userId !== userId) throw new ForbiddenException();
    const updated = await this.prisma.notification.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await this.events.publish({ userId, eventType: EventType.NOTIFICATION_ARCHIVED, sourceModule: 'notifications', payload: { id } });
    return updated;
  }

  async deleteNotification(userId: string, id: string): Promise<{ message: string }> {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.userId !== userId) throw new ForbiddenException();
    await this.prisma.notification.delete({ where: { id } });
    return { message: 'Notification deleted' };
  }
}
