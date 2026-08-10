import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AIProvider, AIChatMessage, AIChatResponse, AISummaryInput, AISummaryResponse } from './ai-provider.interface.js';

export const AI_PROVIDERS = 'AI_PROVIDERS';

// Thrown by generateTextWithVision when at least one vision-capable provider
// is configured but every attempt genuinely failed (quota, network, invalid
// key, malformed response, etc). Callers MUST treat this as a processing
// error, never as a "no food"/"nothing detected" verdict — the model never
// actually saw the image. Distinct from the "no vision provider configured
// at all" case, which still resolves to '' (existing AI-unavailable path).
export class VisionUnavailableError extends Error {
  constructor(message = 'Vision request failed') {
    super(message);
    this.name = 'VisionUnavailableError';
  }
}

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
    let visionProviderConfigured = false;
    let lastError: unknown;

    for (const provider of this.providers) {
      if (!provider.supportsVision()) continue;
      visionProviderConfigured = true;
      if (!this.isReady(provider)) continue;
      try {
        return await provider.generateTextWithVision(imageBase64, mimeType, prompt);
      } catch (err) {
        lastError = err;
        this.handleError(provider, err, 'generateTextWithVision');
      }
    }

    if (!visionProviderConfigured) {
      // No vision-capable provider exists at all (e.g. no Gemini key configured) —
      // this is the genuine "AI unavailable" case; callers already handle an
      // empty string as such.
      return '';
    }

    // A vision-capable provider IS configured but every attempt failed (quota,
    // network, invalid key, ...). Never silently degrade to a text-only guess
    // about an image the model never received — that produces a fabricated,
    // ungrounded "result" indistinguishable from a genuine answer. Surface a
    // real, catchable error instead.
    throw new VisionUnavailableError(
      lastError instanceof Error ? lastError.message : 'Vision request failed',
    );
  }
}
