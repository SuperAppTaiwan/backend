import { Module } from '@nestjs/common';
import { AIController } from './ai.controller.js';
import { AIService } from './ai.service.js';
import { DeterministicAIProvider } from './providers/deterministic-ai.provider.js';
import { GeminiAIProvider } from './providers/gemini-ai.provider.js';
import { GroqAIProvider } from './providers/groq-ai.provider.js';
import { AIProviderChain, AI_PROVIDERS } from './providers/ai-provider-chain.service.js';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { EventsModule } from '../events/events.module.js';
import { AuthModule } from '../auth/auth.module.js';
import type { AIProvider } from './providers/ai-provider.interface.js';

@Module({
  imports: [PrismaModule, EventsModule, AuthModule],
  controllers: [AIController],
  providers: [
    GeminiAIProvider,
    GroqAIProvider,
    DeterministicAIProvider,
    {
      // Priority order: Gemini → Groq → Deterministic (last = always-available fallback)
      // To add a new provider: inject it here and insert before DeterministicAIProvider
      provide: AI_PROVIDERS,
      useFactory: (
        gemini: GeminiAIProvider,
        groq: GroqAIProvider,
        deterministic: DeterministicAIProvider,
      ): AIProvider[] => [gemini, groq, deterministic],
      inject: [GeminiAIProvider, GroqAIProvider, DeterministicAIProvider],
    },
    AIProviderChain,
    AIService,
  ],
  exports: [AIService, AIProviderChain],
})
export class AIModule {}
