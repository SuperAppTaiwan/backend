import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AIProvider, AIChatMessage, AIChatResponse, AISummaryInput, AISummaryResponse } from './ai-provider.interface.js';

export const AI_PROVIDERS = 'AI_PROVIDERS';

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('429') || /rate.?limit|quota.?exceed/i.test(msg);
}

function parseRetryDelay(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/retry in ([\d.]+)s/i);
  return match ? Math.ceil(parseFloat(match[1])) + 2 : 60;
}

/**
 * Chain of Responsibility + Circuit Breaker.
 *
 * Tries each provider in priority order. On any error, moves to the next.
 * On 429 / rate-limit errors, opens a circuit for that provider for the
 * duration specified in the error response, so it is skipped on subsequent
 * calls until the cooldown expires.
 *
 * To add a new provider: implement AIProvider, register in AIModule, and
 * insert into the AI_PROVIDERS array before DeterministicAIProvider.
 */
@Injectable()
export class AIProviderChain {
  private readonly logger = new Logger(AIProviderChain.name);
  private readonly cooldownUntil = new Map<string, number>();

  constructor(@Inject(AI_PROVIDERS) private readonly providers: AIProvider[]) {}

  private isReady(provider: AIProvider): boolean {
    if (!provider.isAvailable()) return false;
    const until = this.cooldownUntil.get(provider.name) ?? 0;
    if (Date.now() < until) return false;
    return true;
  }

  private handleError(provider: AIProvider, err: unknown, method: string): void {
    if (isRateLimitError(err)) {
      const seconds = parseRetryDelay(err);
      this.cooldownUntil.set(provider.name, Date.now() + seconds * 1000);
      this.logger.warn(`${provider.name} rate-limited — circuit open for ${seconds}s`);
    } else {
      this.logger.warn(`${provider.name} ${method} failed, trying next — ${(err as Error).message}`);
    }
  }

  async chat(messages: AIChatMessage[]): Promise<AIChatResponse> {
    for (const provider of this.providers) {
      if (!this.isReady(provider)) continue;
      try {
        return await provider.chat(messages);
      } catch (err) {
        this.handleError(provider, err, 'chat');
      }
    }
    throw new Error('All AI providers failed');
  }

  async generateSummary(input: AISummaryInput): Promise<AISummaryResponse> {
    for (const provider of this.providers) {
      if (!this.isReady(provider)) continue;
      try {
        return await provider.generateSummary(input);
      } catch (err) {
        this.handleError(provider, err, 'generateSummary');
      }
    }
    throw new Error('All AI providers failed');
  }

  async generateText(prompt: string): Promise<string> {
    for (const provider of this.providers) {
      if (!this.isReady(provider)) continue;
      try {
        return await provider.generateText(prompt);
      } catch (err) {
        this.handleError(provider, err, 'generateText');
      }
    }
    return '';
  }

  async generateTextWithVision(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
    for (const provider of this.providers) {
      if (!this.isReady(provider) || !provider.supportsVision()) continue;
      try {
        return await provider.generateTextWithVision(imageBase64, mimeType, prompt);
      } catch (err) {
        this.handleError(provider, err, 'generateTextWithVision');
      }
    }
    // No vision provider available — degrade to text-only
    return this.generateText(prompt);
  }
}
