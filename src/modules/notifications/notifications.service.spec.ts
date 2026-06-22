jest.mock('expo-server-sdk', () => {
  const mockInstance = {
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([]),
    chunkPushNotifications: jest.fn().mockReturnValue([]),
  };
  const MockExpoClass = jest.fn().mockImplementation(() => mockInstance);
  (MockExpoClass as any).isExpoPushToken = jest.fn().mockReturnValue(true);
  return { __esModule: true, default: MockExpoClass };
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service.js';
import { PushService } from './push.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { NotificationType } from '@prisma/client';

const USER_ID = 'user-notif-test';
const OTHER_USER_ID = 'other-user';

const makeNotif = (overrides = {}) => ({
  id: 'notif-1',
  userId: USER_ID,
  type: NotificationType.SYSTEM,
  title: 'Test Notification',
  message: 'This is a test',
  status: 'UNREAD',
  createdAt: new Date(),
  readAt: null,
  ...overrides,
});

const makePrefs = (overrides = {}) => ({
  id: 'pref-1',
  userId: USER_ID,
  taskReminder: true,
  goalReminder: true,
  budgetWarning: true,
  dailyVocabulary: true,
  weeklySummary: true,
  pushEnabled: true,
  emailEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: jest.Mocked<PrismaService>;
  let eventsService: jest.Mocked<EventsService>;

  beforeEach(async () => {
    const mockPrisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
      notificationPreference: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockPush = {
      registerToken: jest.fn(),
      sendPush: jest.fn().mockResolvedValue(undefined),
      isInQuietHours: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventsService, useValue: { publish: jest.fn() } },
        { provide: PushService, useValue: mockPush },
      ],
    }).compile();

    service = module.get(NotificationsService);
    prisma = module.get(PrismaService) as jest.Mocked<PrismaService>;
    eventsService = module.get(EventsService) as jest.Mocked<EventsService>;
  });

  // ─── Preferences ─────────────────────────────────────────────────────────────

  it('returns existing preferences', async () => {
    const prefs = makePrefs();
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(prefs);
    const result = await service.getOrCreatePreferences(USER_ID);
    expect(result).toEqual(prefs);
    expect(prisma.notificationPreference.create).not.toHaveBeenCalled();
  });

  it('creates preferences if not found', async () => {
    const prefs = makePrefs();
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.notificationPreference.create as jest.Mock).mockResolvedValue(prefs);
    const result = await service.getOrCreatePreferences(USER_ID);
    expect(prisma.notificationPreference.create).toHaveBeenCalledWith({ data: { userId: USER_ID } });
    expect(result).toEqual(prefs);
  });

  it('updates preferences', async () => {
    const prefs = makePrefs();
    const updated = makePrefs({ taskReminder: false });
    (prisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue(prefs);
    (prisma.notificationPreference.update as jest.Mock).mockResolvedValue(updated);
    const result = await service.updatePreferences(USER_ID, { taskReminder: false });
    expect(result.taskReminder).toBe(false);
    expect(eventsService.publish).toHaveBeenCalled();
  });

  // ─── Create Notification ──────────────────────────────────────────────────────

  it('creates notification and publishes event', async () => {
    const notif = makeNotif();
    (prisma.notification.create as jest.Mock).mockResolvedValue(notif);
    const result = await service.createNotification(USER_ID, NotificationType.SYSTEM, 'Test', 'Test msg');
    expect(result).toEqual(notif);
    expect(eventsService.publish).toHaveBeenCalled();
  });

  // ─── Find / Count ─────────────────────────────────────────────────────────────

  it('lists all notifications', async () => {
    const notifs = [makeNotif(), makeNotif({ id: 'notif-2', status: 'READ' })];
    (prisma.notification.findMany as jest.Mock).mockResolvedValue(notifs);
    const result = await service.findAll(USER_ID);
    expect(result).toHaveLength(2);
  });

  it('lists only unread notifications', async () => {
    const notifs = [makeNotif()];
    (prisma.notification.findMany as jest.Mock).mockResolvedValue(notifs);
    const result = await service.findAll(USER_ID, true);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'UNREAD' }) }),
    );
    expect(result).toHaveLength(1);
  });

  it('counts unread notifications', async () => {
    (prisma.notification.count as jest.Mock).mockResolvedValue(3);
    const result = await service.countUnread(USER_ID);
    expect(result).toEqual({ count: 3 });
  });

  // ─── Mark Read ────────────────────────────────────────────────────────────────

  it('marks notification as read', async () => {
    const notif = makeNotif();
    (prisma.notification.findFirst as jest.Mock).mockResolvedValue(notif);
    (prisma.notification.update as jest.Mock).mockResolvedValue({ ...notif, status: 'READ' });
    const result = await service.markRead(USER_ID, notif.id);
    expect(result.status).toBe('READ');
    expect(eventsService.publish).toHaveBeenCalled();
  });

  it('throws NotFoundException when marking non-existent notification as read', async () => {
    (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.markRead(USER_ID, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('marks all notifications as read', async () => {
    (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 5 });
    const result = await service.markAllRead(USER_ID);
    expect(result).toEqual({ updated: 5 });
  });

  // ─── Archive ─────────────────────────────────────────────────────────────────

  it('archives notification', async () => {
    const notif = makeNotif();
    (prisma.notification.findFirst as jest.Mock).mockResolvedValue(notif);
    (prisma.notification.update as jest.Mock).mockResolvedValue({ ...notif, status: 'ARCHIVED' });
    const result = await service.archive(USER_ID, notif.id);
    expect(result.status).toBe('ARCHIVED');
  });

  it('throws NotFoundException when archiving non-existent notification', async () => {
    (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.archive(USER_ID, 'missing')).rejects.toThrow(NotFoundException);
  });

  // ─── Delete ──────────────────────────────────────────────────────────────────

  it('deletes notification', async () => {
    const notif = makeNotif();
    (prisma.notification.findFirst as jest.Mock).mockResolvedValue(notif);
    (prisma.notification.delete as jest.Mock).mockResolvedValue(notif);
    const result = await service.deleteNotification(USER_ID, notif.id);
    expect(result.message).toBe('Notification deleted');
  });

  it('throws NotFoundException when deleting non-existent notification', async () => {
    (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.deleteNotification(USER_ID, 'missing')).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when notification belongs to another user', async () => {
    const notif = makeNotif({ userId: OTHER_USER_ID });
    (prisma.notification.findFirst as jest.Mock).mockResolvedValue(notif);
    await expect(service.deleteNotification(USER_ID, notif.id)).rejects.toThrow(ForbiddenException);
  });
});
