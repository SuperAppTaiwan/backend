import { Injectable, Logger } from '@nestjs/common';
import Expo, { ExpoPushMessage } from 'expo-server-sdk';
import { PushPlatform } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo = new Expo();

  constructor(private readonly prisma: PrismaService) {}

  async registerToken(userId: string, token: string, platform: string, deviceId: string) {
    const pushPlatform = platform as PushPlatform;
    return this.prisma.pushToken.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      update: { token, platform: pushPlatform },
      create: { userId, token, platform: pushPlatform, deviceId },
    });
  }

  async sendPush(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const tokens = await this.prisma.pushToken.findMany({ where: { userId } });
    if (tokens.length === 0) return;

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.token))
      .map((t) => ({
        to: t.token,
        sound: 'default' as const,
        title,
        body,
        data: data ?? {},
      }));

    if (messages.length === 0) return;

    const chunks = this.expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        const receipts = await this.expo.sendPushNotificationsAsync(chunk);
        for (const receipt of receipts) {
          if (receipt.status === 'error') {
            this.logger.warn(`Push error: ${receipt.message}`);
            if (receipt.details?.error === 'DeviceNotRegistered') {
              await this.removeInvalidTokenForReceipt(userId, chunk);
            }
          }
        }
      } catch (err) {
        this.logger.error('Failed to send push notifications', err);
      }
    }
  }

  private async removeInvalidTokenForReceipt(userId: string, chunk: ExpoPushMessage[]) {
    for (const msg of chunk) {
      await this.prisma.pushToken.deleteMany({
        where: { userId, token: msg.to as string },
      });
    }
  }

  async isInQuietHours(quietStart?: string | null, quietEnd?: string | null): Promise<boolean> {
    if (!quietStart || !quietEnd) return false;

    const now = new Date();
    const [startH, startM] = quietStart.split(':').map(Number);
    const [endH, endM] = quietEnd.split(':').map(Number);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes < endMinutes;
    }
    // overnight quiet hours (e.g., 22:00–07:00)
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
}
