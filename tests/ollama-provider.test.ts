import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderIdentity, ProviderConnection, ProviderInference } from '../src/providers/types.js';

// Mock the ollama package before importing the provider
const mockOllamaClient = {
  list: vi.fn(),
  chat: vi.fn(),
};

vi.mock('ollama', () => ({
  Ollama: vi.fn().mockImplementation(function() {
    return mockOllamaClient;
  }),
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generate()', () => {
    it('sends chat request and extracts content', async () => {
      mockOllamaClient.chat.mockResolvedValueOnce({
        message: { content: 'test response' },
      });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      const result = await provider.generate('hello', 'system prompt');

      expect(result).toBe('test response');
      expect(mockOllamaClient.chat).toHaveBeenCalledOnce();

      const [call] = mockOllamaClient.chat.mock.calls;
      expect(call[0]).toMatchObject({
        model: 'test-model',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'hello' },
        ],
        options: {
          num_predict: 4096,
          temperature: 0.3,
        },
      });
    });

    it('works without system prompt', async () => {
      mockOllamaClient.chat.mockResolvedValueOnce({
        message: { content: 'chat response' },
      });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      const result = await provider.generate('hello');

      expect(result).toBe('chat response');

      const [call] = mockOllamaClient.chat.mock.calls;
      expect(call[0].messages).toEqual([
        { role: 'user', content: 'hello' },
      ]);
    });
  });

  describe('isAvailable()', () => {
    it('returns true when server responds', async () => {
      mockOllamaClient.list.mockResolvedValueOnce({ models: [] });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when list throws', async () => {
      mockOllamaClient.list.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('generate() error handling', () => {
    it('propagates errors to allow caller retry logic', async () => {
      mockOllamaClient.chat.mockRejectedValueOnce(new Error('Connection failed'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      await expect(provider.generate('hello')).rejects.toThrow('Connection failed');
    });
  });
});
