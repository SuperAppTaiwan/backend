import { Module } from '@nestjs/common';
import { AIController } from './ai.controller.js';
import { AIService } from './ai.service.js';
import { DeterministicAIProvider } from './providers/deterministic-ai.provider.js';
import { ClaudeAIProvider } from './providers/claude-ai.provider.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule],
  controllers: [AIController],
  providers: [AIService, DeterministicAIProvider, ClaudeAIProvider],
  exports: [AIService],
})
export class AIModule {}
