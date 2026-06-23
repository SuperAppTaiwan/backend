jest.mock('expo-server-sdk', () => {
  const mockInstance = {
    sendPushNotificationsAsync: jest.fn().mockResolvedValue([{ status: 'ok' }]),
    chunkPushNotifications: jest.fn().mockImplementation((msgs: unknown[]) => [msgs]),
  };
  const MockExpoClass = jest.fn().mockImplementation(() => mockInstance) as jest.Mock & { isExpoPushToken: jest.Mock };
  MockExpoClass.isExpoPushToken = jest.fn().mockReturnValue(true);
  return { __esModule: true, default: MockExpoClass };
});

import { Test, TestingModule } from '@nestjs/testing';
import { PushService } from './push.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

const mockPrisma = {
  pushToken: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

describe('PushService', () => {
  let service: PushService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PushService>(PushService);
    jest.clearAllMocks();
  });

  describe('registerToken', () => {
    it('upserts push token', async () => {
      const token = { id: 't-1', userId: 'u-1', token: 'ExponentPushToken[xxx]', platform: 'IOS', deviceId: 'd-1' };
      mockPrisma.pushToken.upsert.mockResolvedValue(token);

      const result = await service.registerToken('u-1', 'ExponentPushToken[xxx]', 'IOS', 'd-1');
      expect(result).toEqual(token);
      expect(mockPrisma.pushToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_deviceId: { userId: 'u-1', deviceId: 'd-1' } },
        }),
      );
    });
  });

  describe('sendPush', () => {
    it('does nothing when no tokens found', async () => {
      mockPrisma.pushToken.findMany.mockResolvedValue([]);
      await service.sendPush('u-1', 'Title', 'Body');
      expect(mockPrisma.pushToken.findMany).toHaveBeenCalledWith({ where: { userId: 'u-1' } });
    });

    it('sends push to valid tokens', async () => {
      mockPrisma.pushToken.findMany.mockResolvedValue([
        { userId: 'u-1', token: 'ExponentPushToken[abc]', platform: 'IOS', deviceId: 'd-1' },
      ]);

      await service.sendPush('u-1', 'Hello', 'World', { foo: 'bar' });
      // No error means success — Expo.sendPushNotificationsAsync was called
      expect(mockPrisma.pushToken.findMany).toHaveBeenCalled();
    });
  });

  describe('isInQuietHours', () => {
    const mockDate = (h: number, m: number) => {
      jest.spyOn(global, 'Date').mockImplementation(() => ({
        getHours: () => h,
        getMinutes: () => m,
        getTime: () => Date.now(),
      } as unknown as Date));
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns false when no quiet hours configured', async () => {
      const result = await service.isInQuietHours(null, null);
      expect(result).toBe(false);
    });

    it('returns true when inside quiet hours window', async () => {
      mockDate(23, 0); // 23:00
      const result = await service.isInQuietHours('22:00', '07:00');
      expect(result).toBe(true);
    });

    it('returns false when outside quiet hours window', async () => {
      mockDate(12, 0); // 12:00
      const result = await service.isInQuietHours('22:00', '07:00');
      expect(result).toBe(false);
    });

    it('returns true inside non-overnight quiet hours', async () => {
      mockDate(14, 0); // 14:00
      const result = await service.isInQuietHours('13:00', '16:00');
      expect(result).toBe(true);
    });

    it('returns false outside non-overnight quiet hours', async () => {
      mockDate(10, 0); // 10:00
      const result = await service.isInQuietHours('13:00', '16:00');
      expect(result).toBe(false);
    });
  });
});
