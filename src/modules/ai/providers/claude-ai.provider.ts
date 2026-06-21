import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AIProvider, AIChatMessage, AIChatResponse, AISummaryInput, AISummaryResponse } from './ai-provider.interface.js';

@Injectable()
export class ClaudeAIProvider implements AIProvider {
  private readonly logger = new Logger(ClaudeAIProvider.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('ANTHROPIC_API_KEY') || undefined;
    this.model = this.config.get<string>('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async chat(messages: AIChatMessage[]): Promise<AIChatResponse> {
    if (!this.apiKey) throw new Error('Claude API key not configured');
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: this.apiKey });
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      return { message: text, provider: 'claude' };
    } catch (err) {
      this.logger.error('Claude chat failed', err);
      throw err;
    }
  }

  async generateSummary(input: AISummaryInput): Promise<AISummaryResponse> {
    if (!this.apiKey) throw new Error('Claude API key not configured');
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: this.apiKey });
      const prompt = `Based on this user's data, generate a brief Vietnamese daily summary (2-3 sentences, warm and motivating): ${JSON.stringify(input.context)}`;
      const response = await client.messages.create({
        model: this.model,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      return { summary: text, provider: 'claude' };
    } catch (err) {
      this.logger.error('Claude summary failed', err);
      throw err;
    }
  }
}
