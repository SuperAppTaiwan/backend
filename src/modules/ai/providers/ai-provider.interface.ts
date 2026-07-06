export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatResponse {
  message: string;
  provider: string;
}

export interface AISummaryInput {
  userId: string;
  context: Record<string, unknown>;
}

export interface AISummaryResponse {
  summary: string;
  provider: string;
}

export interface AIProvider {
  readonly name: string;
  isAvailable(): boolean;
  supportsVision(): boolean;
  chat(messages: AIChatMessage[]): Promise<AIChatResponse>;
  generateSummary(input: AISummaryInput): Promise<AISummaryResponse>;
  generateText(prompt: string): Promise<string>;
  generateTextWithVision(imageBase64: string, mimeType: string, prompt: string): Promise<string>;
}
