import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AIProvider, AIChatMessage, AIChatResponse, AISummaryInput, AISummaryResponse } from './ai-provider.interface.js';

@Injectable()
export class GeminiAIProvider implements AIProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiAIProvider.name);
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY') || undefined;
    this.model = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-flash-latest';
  }

  isAvailable(): boolean { return Boolean(this.apiKey); }
  supportsVision(): boolean { return Boolean(this.apiKey); }

  async generateText(prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('Gemini API key not configured');
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const genModel = genAI.getGenerativeModel({ model: this.model });
    const result = await genModel.generateContent(prompt);
    return result.response.text();
  }

  async generateTextWithVision(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('Gemini API key not configured');
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const genModel = genAI.getGenerativeModel({ model: this.model });
    const imagePart = {
      inlineData: { mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: imageBase64 },
    };
    const result = await genModel.generateContent([imagePart, prompt]);
    return result.response.text();
  }

  async chat(messages: AIChatMessage[]): Promise<AIChatResponse> {
    if (!this.apiKey) throw new Error('Gemini API key not configured');
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const genModel = genAI.getGenerativeModel({ model: this.model });

      const history = messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const lastMessage = messages[messages.length - 1];

      const chat = genModel.startChat({ history });
      const result = await chat.sendMessage(lastMessage?.content ?? '');
      return { message: result.response.text(), provider: this.name };
    } catch (err) {
      this.logger.error('Gemini chat failed', err);
      throw err;
    }
  }

  async generateSummary(input: AISummaryInput): Promise<AISummaryResponse> {
    if (!this.apiKey) throw new Error('Gemini API key not configured');
    try {
      const prompt = `Based on this user's data, generate a brief Vietnamese daily summary (2-3 sentences, warm and motivating): ${JSON.stringify(input.context)}`;
      const text = await this.generateText(prompt);
      return { summary: text, provider: this.name };
    } catch (err) {
      this.logger.error('Gemini summary failed', err);
      throw err;
    }
  }
}
