import { Module } from '@nestjs/common';
import { ScheduleController } from './schedule.controller.js';
import { ScheduleService } from './schedule.service.js';
import { ScheduleEventsService } from './schedule-events.service.js';
import { RecurrenceService } from './recurrence.service.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule],
  controllers: [ScheduleController],
  providers: [ScheduleService, ScheduleEventsService, RecurrenceService],
  exports: [ScheduleService, ScheduleEventsService],
})
export class ScheduleModule {}
