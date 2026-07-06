import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { AIProvider, AIChatMessage, AIChatResponse, AISummaryInput, AISummaryResponse } from './ai-provider.interface.js';

@Injectable()
export class GroqAIProvider implements AIProvider {
  readonly name = 'groq';
  private readonly logger = new Logger(GroqAIProvider.name);
  private readonly client: OpenAI | undefined;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GROQ_API_KEY') || undefined;
    this.model = this.config.get<string>('GROQ_MODEL') ?? 'llama-3.1-8b-instant';
    if (apiKey) {
      this.client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
    }
  }

  isAvailable(): boolean { return Boolean(this.client); }
  supportsVision(): boolean { return false; }

  async generateText(prompt: string): Promise<string> {
    if (!this.client) throw new Error('Groq not configured');
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    });
    return completion.choices[0]?.message.content ?? '';
  }

  async generateTextWithVision(_imageBase64: string, _mimeType: string, _prompt: string): Promise<string> {
    throw new Error('Groq provider does not support vision');
  }

  async chat(messages: AIChatMessage[]): Promise<AIChatResponse> {
    if (!this.client) throw new Error('Groq not configured');
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      return { message: completion.choices[0]?.message.content ?? '', provider: this.name };
    } catch (err) {
      this.logger.error('Groq chat failed', err);
      throw err;
    }
  }

  async generateSummary(input: AISummaryInput): Promise<AISummaryResponse> {
    if (!this.client) throw new Error('Groq not configured');
    try {
      const prompt = `Based on this user's data, generate a brief Vietnamese daily summary (2-3 sentences, warm and motivating): ${JSON.stringify(input.context)}`;
      const text = await this.generateText(prompt);
      return { summary: text, provider: this.name };
    } catch (err) {
      this.logger.error('Groq summary failed', err);
      throw err;
    }
  }
}
