import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../src/providers/ollama-provider.js';
import type { ProviderIdentity, ProviderConnection, ProviderInference } from '../src/providers/types.js';
import { Pool } from 'undici';

// Mock undici at the top level before any imports
vi.mock('undici', () => {
  let poolMock: any;

  return {
    Pool: vi.fn().mockImplementation((url: string, options: any) => {
      poolMock = {
        request: vi.fn(),
        close: vi.fn(),
      };
      return poolMock;
    }),
  };
});

function makeIdentity(overrides?: Partial<ProviderIdentity>): ProviderIdentity {
  return { id: 'test', model: 'test-model', ...overrides };
}

function makeConnection(overrides?: Partial<ProviderConnection>): ProviderConnection {
  return { baseUrl: 'http://localhost:11434', apiStyle: 'openai', timeout: 30000, ...overrides };
}

function makeInference(overrides?: Partial<ProviderInference>): ProviderInference {
  return { maxTokens: 4096, temperature: 0.3, ...overrides };
}

describe('OllamaProvider', () => {
  let poolMock: any;

  beforeEach(() => {
    // Reset the pool mock for each test
    poolMock = {
      request: vi.fn(),
      close: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generate() with openai style', () => {
    it('sends request to /v1/chat/completions and extracts content', async () => {
      poolMock.request.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'test response' } }] }),
          text: vi.fn().mockResolvedValue(''),
        },
      });

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'openai' }), makeInference());
      const result = await provider.generate('hello', 'system prompt');

      expect(result).toBe('test response');
      expect(poolMock.request).toHaveBeenCalledOnce();

      const [url, opts] = poolMock.request.mock.calls[0];
      expect(url).toBe('/v1/chat/completions');

      const body = JSON.parse(opts.body as string);
      expect(body.model).toBe('test-model');
      expect(body.messages).toEqual([
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'hello' },
      ]);
      expect(body.stream).toBe(false);
    });
  });

  describe('generate() with chat style', () => {
    it('sends request to /api/chat and extracts message content', async () => {
      poolMock.request.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({ message: { content: 'chat response' } }),
          text: vi.fn().mockResolvedValue(''),
        },
      });

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'chat' }), makeInference());
      const result = await provider.generate('hello');

      expect(result).toBe('chat response');

      const [url] = poolMock.request.mock.calls[0];
      expect(url).toBe('/api/chat');
    });
  });

  describe('generate() with generate style', () => {
    it('sends request to /api/generate with prompt field', async () => {
      poolMock.request.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({ response: 'gen response' }),
          text: vi.fn().mockResolvedValue(''),
        },
      });

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'generate' }), makeInference());
      const result = await provider.generate('hello', 'sys');

      expect(result).toBe('gen response');

      const [url, opts] = poolMock.request.mock.calls[0];
      expect(url).toBe('/api/generate');

      const body = JSON.parse(opts.body as string);
      expect(body.prompt).toContain('hello');
      expect(body.prompt).toContain('sys');
      expect(body.messages).toBeUndefined();
    });
  });

  describe('detectApiStyle() auto-probing', () => {
    it('probes endpoints and caches the result', async () => {
      // openai probe returns 404, chat probe returns 200
      poolMock.request
        .mockResolvedValueOnce({
          statusCode: 404,
          body: {
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          },
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          },
        });

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'auto' }), makeInference());

      const style = await provider.detectApiStyle();
      expect(style).toBe('chat');

      // Second call should use cached value — no additional pool requests
      const callsBefore = poolMock.request.mock.calls.length;
      const style2 = await provider.detectApiStyle();
      expect(style2).toBe('chat');
      expect(poolMock.request.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('isAvailable()', () => {
    it('returns true when server responds with 200', async () => {
      poolMock.request.mockResolvedValueOnce({
        statusCode: 200,
        body: {
          json: vi.fn().mockResolvedValue({}),
          text: vi.fn().mockResolvedValue(''),
        },
      });

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when pool.request throws', async () => {
      poolMock.request.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('generate() error handling', () => {
    it('returns empty string on HTTP 500', async () => {
      poolMock.request
        .mockResolvedValueOnce({
          statusCode: 200,
          body: {
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue(''),
          },
        })   // detectApiStyle probe
        .mockResolvedValueOnce({
          statusCode: 500,
          body: {
            json: vi.fn().mockResolvedValue({}),
            text: vi.fn().mockResolvedValue('Internal Server Error'),
          },
        });

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'auto' }), makeInference());
      const result = await provider.generate('hello');

      expect(result).toBe('');
    });
  });
});
