import { AIProviderChain, VisionUnavailableError } from './ai-provider-chain.service.js';
import type { AIProvider } from './ai-provider.interface.js';

function makeProvider(overrides: Partial<AIProvider> & { name: string }): AIProvider {
  return {
    isAvailable: () => true,
    supportsVision: () => false,
    chat: jest.fn(),
    generateSummary: jest.fn(),
    generateText: jest.fn().mockResolvedValue(''),
    generateTextWithVision: jest.fn().mockRejectedValue(new Error('not implemented')),
    ...overrides,
  };
}

function makeChain(providers: AIProvider[]): AIProviderChain {
  return new AIProviderChain(providers as unknown as never);
}

describe('AIProviderChain.generateTextWithVision', () => {
  it('returns the first ready vision-capable provider\'s result', async () => {
    const gemini = makeProvider({
      name: 'gemini',
      supportsVision: () => true,
      generateTextWithVision: jest.fn().mockResolvedValue('{"isFood":true,"name":"Apple"}'),
    });
    const chain = makeChain([gemini]);

    const result = await chain.generateTextWithVision('base64', 'image/jpeg', 'prompt');

    expect(result).toBe('{"isFood":true,"name":"Apple"}');
  });

  it('returns empty string when NO provider supports vision at all (genuine AI-unavailable case)', async () => {
    const groq = makeProvider({ name: 'groq', supportsVision: () => false });
    const deterministic = makeProvider({ name: 'deterministic', supportsVision: () => false });
    const chain = makeChain([groq, deterministic]);

    const result = await chain.generateTextWithVision('base64', 'image/jpeg', 'prompt');

    expect(result).toBe('');
    // Must not have silently degraded to a text-only call about an image
    // no provider ever received.
    expect(groq.generateText).not.toHaveBeenCalled();
  });

  it('throws VisionUnavailableError (never silently degrades to text-only) when a vision-capable provider is configured but every attempt fails', async () => {
    const gemini = makeProvider({
      name: 'gemini',
      supportsVision: () => true,
      generateTextWithVision: jest.fn().mockRejectedValue(new Error('429 quota exceeded')),
    });
    const groq = makeProvider({ name: 'groq', supportsVision: () => false });
    const chain = makeChain([gemini, groq]);

    await expect(chain.generateTextWithVision('base64', 'image/jpeg', 'prompt')).rejects.toThrow(
      VisionUnavailableError,
    );
    // The critical regression this guards against: a failed vision call must
    // NEVER fall through to a blind text completion of the same "describe
    // this image" prompt — that produces a fabricated, ungrounded answer
    // indistinguishable from a genuine result.
    expect(groq.generateText).not.toHaveBeenCalled();
  });

  it('skips a vision-capable provider that is in cooldown (rate-limited) rather than throwing immediately', async () => {
    const gemini = makeProvider({
      name: 'gemini',
      supportsVision: () => true,
      generateTextWithVision: jest.fn().mockRejectedValue(new Error('429 Too Many Requests. Please retry in 5s.')),
    });
    const chain = makeChain([gemini]);

    // First call opens the circuit breaker for gemini and throws.
    await expect(chain.generateTextWithVision('b64', 'image/jpeg', 'p')).rejects.toThrow(VisionUnavailableError);
    // Second call within the cooldown window: gemini is skipped via isReady(),
    // but it's still the only vision-capable provider, so this must still be
    // VisionUnavailableError, not a silent '' (which would read as "unavailable"
    // rather than "currently failing").
    await expect(chain.generateTextWithVision('b64', 'image/jpeg', 'p')).rejects.toThrow(VisionUnavailableError);
    expect(gemini.generateTextWithVision).toHaveBeenCalledTimes(1);
  });
});

describe('AIProviderChain.generateText (unaffected by the vision fix)', () => {
  it('still falls through providers in order on failure', async () => {
    const gemini = makeProvider({ name: 'gemini', generateText: jest.fn().mockRejectedValue(new Error('down')) });
    const groq = makeProvider({ name: 'groq', generateText: jest.fn().mockResolvedValue('groq says hi') });
    const chain = makeChain([gemini, groq]);

    const result = await chain.generateText('prompt');

    expect(result).toBe('groq says hi');
  });

  it('returns empty string when every provider fails', async () => {
    const gemini = makeProvider({ name: 'gemini', generateText: jest.fn().mockRejectedValue(new Error('down')) });
    const chain = makeChain([gemini]);

    const result = await chain.generateText('prompt');

    expect(result).toBe('');
  });
});
