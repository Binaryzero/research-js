import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderIdentity, ProviderConnection, ProviderInference } from '../src/providers/types.js';

// Mock the AI SDK packages before importing the provider
const mockGenerateText = vi.fn();
const mockGenerateObject = vi.fn();
const mockCreateOllama = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock('ollama-ai-provider', () => ({
  createOllama: vi.fn().mockImplementation((...args: unknown[]) => mockCreateOllama(...args)),
}));

// Import after mocking
const { OllamaProvider } = await import('../src/providers/ollama-provider.js');

function makeIdentity(overrides?: Partial<ProviderIdentity>): ProviderIdentity {
  return { id: 'test', model: 'test-model', ...overrides };
}

function makeConnection(overrides?: Partial<ProviderConnection>): ProviderConnection {
  const defaultPort = 11434 + Math.floor(Math.random() * 1000);
  const defaultBaseUrl = `http://localhost:${defaultPort}`;
  return { baseUrl: defaultBaseUrl, timeout: 30000, ...overrides };
}

function makeInference(overrides?: Partial<ProviderInference>): ProviderInference {
  return { maxTokens: 4096, temperature: 0.3, ...overrides };
}

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({ text: 'mocked response' });
    mockCreateOllama.mockReturnValue(vi.fn().mockReturnValue('ollama-model'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generate()', () => {
    it('sends chat request and extracts content', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: 'test response' });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      const result = await provider.generate('hello', 'system prompt');

      expect(result).toBe('test response');
      expect(mockGenerateText).toHaveBeenCalledOnce();

      const [call] = mockGenerateText.mock.calls;
      expect(call[0]).toMatchObject({
        model: 'ollama-model',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'hello' },
        ],
        maxOutputTokens: 4096,
        temperature: 0.3,
      });
    });

    it('works without system prompt', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: 'chat response' });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      const result = await provider.generate('hello');

      expect(result).toBe('chat response');

      const [call] = mockGenerateText.mock.calls;
      expect(call[0].messages).toEqual([
        { role: 'user', content: 'hello' },
      ]);
    });
  });

  describe('isAvailable()', () => {
    it('returns true when server responds', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when fetch fails', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('generate() error handling', () => {
    it('propagates errors to allow caller retry logic', async () => {
      mockGenerateText.mockRejectedValueOnce(new Error('Connection failed'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      await expect(provider.generate('hello')).rejects.toThrow('Connection failed');
    });
  });

  describe('generateObject()', () => {
    it('generates structured output matching schema', async () => {
      const mockSchema = { parse: vi.fn().mockReturnValue({ risk_level: 'high' }) };
      mockGenerateObject.mockResolvedValueOnce({ object: { risk_level: 'high' } });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      const result = await provider.generateObject(mockSchema as any, 'analyze this', 'system prompt');

      expect(result).toEqual({ risk_level: 'high' });
      expect(mockGenerateObject).toHaveBeenCalledOnce();

      const [call] = mockGenerateObject.mock.calls;
      expect(call[0]).toMatchObject({
        schema: mockSchema,
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'analyze this' },
        ],
        maxOutputTokens: 4096,
        temperature: 0.3,
      });
    });

    it('works without system prompt', async () => {
      const mockSchema = { parse: vi.fn().mockReturnValue({ risk_level: 'low' }) };
      mockGenerateObject.mockResolvedValueOnce({ object: { risk_level: 'low' } });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      const result = await provider.generateObject(mockSchema as any, 'analyze this');

      expect(result).toEqual({ risk_level: 'low' });

      const [call] = mockGenerateObject.mock.calls;
      expect(call[0].messages).toEqual([
        { role: 'user', content: 'analyze this' },
      ]);
    });

    it('propagates errors', async () => {
      const mockSchema = { parse: vi.fn() };
      mockGenerateObject.mockRejectedValueOnce(new Error('Schema validation failed'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      await expect(provider.generateObject(mockSchema as any, 'hello')).rejects.toThrow('Schema validation failed');
    });
  });
});
