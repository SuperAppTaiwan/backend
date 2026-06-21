import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export enum EventType {
  USER_REGISTERED = 'USER_REGISTERED',
  USER_LOGGED_IN = 'USER_LOGGED_IN',
  USER_LOGGED_OUT = 'USER_LOGGED_OUT',
  PROFILE_UPDATED = 'PROFILE_UPDATED',
}

export interface PublishEventDto {
  userId?: string;
  eventType: EventType | string;
  sourceModule: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async publish(dto: PublishEventDto): Promise<void> {
    try {
      await this.prisma.event.create({
        data: {
          userId: dto.userId,
          eventType: dto.eventType,
          sourceModule: dto.sourceModule,
          payloadJson: dto.payload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to publish event ${dto.eventType}`, err);
    }
  }
}
