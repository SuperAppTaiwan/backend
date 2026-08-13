import { Module } from '@nestjs/common';
import { ChineseStoryController } from './chinese-story.controller.js';
import { ChineseStoryService } from './chinese-story.service.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AIModule } from '../ai/ai.module.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule, AIModule],
  controllers: [ChineseStoryController],
  providers: [ChineseStoryService],
  exports: [ChineseStoryService],
})
export class ChineseStoryModule {}
