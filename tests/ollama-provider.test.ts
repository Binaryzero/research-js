import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderIdentity, ProviderConnection, ProviderInference } from '../src/providers/types.js';

// Mock @ai-sdk/openai and ai before importing the provider
const mockGenerateText = vi.fn();
const mockGenerateObject = vi.fn();
const mockModelFactory = vi.fn().mockReturnValue('mock-model-instance');
const mockCreateOpenAI = vi.fn().mockReturnValue(mockModelFactory);

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => mockCreateOpenAI(...args),
}));

// Import after mocking
const { OllamaProvider } = await import('../src/providers/ollama-provider.js');

function makeIdentity(overrides?: Partial<ProviderIdentity>): ProviderIdentity {
  return { id: 'test', model: 'test-model', ...overrides };
}

function makeConnection(overrides?: Partial<ProviderConnection>): ProviderConnection {
  const defaultPort = 11434 + Math.floor(Math.random() * 1000);
  return { baseUrl: `http://localhost:${defaultPort}`, timeout: 30000, ...overrides };
}

function makeInference(overrides?: Partial<ProviderInference>): ProviderInference {
  return { maxTokens: 4096, temperature: 0.3, ...overrides };
}

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({ text: 'mocked response' });
    mockCreateOpenAI.mockReturnValue(mockModelFactory);
    mockModelFactory.mockReturnValue('mock-model-instance');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generate()', () => {
    it('creates client with /v1 baseURL and calls generateText', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: 'test response' });

      const conn = makeConnection({ baseUrl: 'http://localhost:11434' });
      const provider = new OllamaProvider(makeIdentity(), conn, makeInference());
      const result = await provider.generate('hello', 'system prompt');

      expect(result).toBe('test response');

      // Verify client was constructed pointing at Ollama's /v1 endpoint
      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: 'http://localhost:11434/v1',
        apiKey: 'ollama',
      });

      // Verify generateText received the correct parameters
      expect(mockGenerateText).toHaveBeenCalledOnce();
      const [call] = mockGenerateText.mock.calls;
      expect(call[0]).toMatchObject({
        model: 'mock-model-instance',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'hello' },
        ],
        maxOutputTokens: 4096,
        temperature: 0.3,
      });
    });

    it('omits system message when not provided', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: 'chat response' });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      const result = await provider.generate('hello');

      expect(result).toBe('chat response');
      const [call] = mockGenerateText.mock.calls;
      expect(call[0].messages).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('uses provided apiKey when set', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: 'ok' });

      const conn = makeConnection({ baseUrl: 'http://myhost:11434', apiKey: 'secret' });
      const provider = new OllamaProvider(makeIdentity(), conn, makeInference());
      await provider.generate('hello');

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: 'http://myhost:11434/v1',
        apiKey: 'secret',
      });
    });

    it('propagates errors so caller retry logic can handle them', async () => {
      mockGenerateText.mockRejectedValueOnce(new Error('Connection failed'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      await expect(provider.generate('hello')).rejects.toThrow('Connection failed');
    });

    it('returns empty string when text is null', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: null });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      const result = await provider.generate('hello');
      expect(result).toBe('');
    });
  });

  describe('isAvailable()', () => {
    it('checks /api/tags and returns true on success', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: true });

      const conn = makeConnection({ baseUrl: 'http://localhost:11434' });
      const provider = new OllamaProvider(makeIdentity(), conn, makeInference());
      expect(await provider.isAvailable()).toBe(true);

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.objectContaining({ signal: expect.anything() })
      );
    });

    it('returns false when server is unreachable', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns false on non-OK response', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('generateObject()', () => {
    it('calls generateObject with schema and messages', async () => {
      const mockSchema = { _type: 'schema' };
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

    it('omits system message when not provided', async () => {
      mockGenerateObject.mockResolvedValueOnce({ object: { risk_level: 'low' } });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      await provider.generateObject({} as any, 'analyze this');

      const [call] = mockGenerateObject.mock.calls;
      expect(call[0].messages).toEqual([{ role: 'user', content: 'analyze this' }]);
    });

    it('propagates errors', async () => {
      mockGenerateObject.mockRejectedValueOnce(new Error('Schema validation failed'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      await expect(provider.generateObject({} as any, 'hello')).rejects.toThrow('Schema validation failed');
    });
  });
});
