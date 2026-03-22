import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../src/providers/ollama-provider.js';
import type { ProviderIdentity, ProviderConnection, ProviderInference } from '../src/providers/types.js';

function makeIdentity(overrides?: Partial<ProviderIdentity>): ProviderIdentity {
  return { id: 'test', model: 'test-model', ...overrides };
}

function makeConnection(overrides?: Partial<ProviderConnection>): ProviderConnection {
  return { baseUrl: 'http://localhost:11434', apiStyle: 'openai', timeout: 30000, ...overrides };
}

function makeInference(overrides?: Partial<ProviderInference>): ProviderInference {
  return { maxTokens: 4096, temperature: 0.3, ...overrides };
}

/** Build a mock Response with JSON body */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OllamaProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generate() with openai style', () => {
    it('sends request to /v1/chat/completions and extracts content', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: 'test response' } }] }),
      );

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'openai' }), makeInference());
      const result = await provider.generate('hello', 'system prompt');

      expect(result).toBe('test response');
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:11434/v1/chat/completions');

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
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ message: { content: 'chat response' } }),
      );

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'chat' }), makeInference());
      const result = await provider.generate('hello');

      expect(result).toBe('chat response');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/chat');
    });
  });

  describe('generate() with generate style', () => {
    it('sends request to /api/generate with prompt field', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ response: 'gen response' }),
      );

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'generate' }), makeInference());
      const result = await provider.generate('hello', 'sys');

      expect(result).toBe('gen response');

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:11434/api/generate');

      const body = JSON.parse(opts.body as string);
      expect(body.prompt).toContain('hello');
      expect(body.prompt).toContain('sys');
      expect(body.messages).toBeUndefined();
    });
  });

  describe('detectApiStyle() auto-probing', () => {
    it('probes endpoints and caches the result', async () => {
      // openai probe returns 404, chat probe returns 200
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'auto' }), makeInference());

      const style = await provider.detectApiStyle();
      expect(style).toBe('chat');

      // Second call should use cached value — no additional fetch calls
      const callsBefore = fetchMock.mock.calls.length;
      const style2 = await provider.detectApiStyle();
      expect(style2).toBe('chat');
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('isAvailable()', () => {
    it('returns true when server responds with 200', async () => {
      fetchMock.mockResolvedValueOnce(new Response('Ollama is running', { status: 200 }));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(true);
    });

    it('returns false when fetch throws', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const provider = new OllamaProvider(makeIdentity(), makeConnection(), makeInference());
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('generate() error handling', () => {
    it('returns empty string on HTTP 500', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))   // detectApiStyle probe
        .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

      const provider = new OllamaProvider(makeIdentity(), makeConnection({ apiStyle: 'auto' }), makeInference());
      const result = await provider.generate('hello');

      expect(result).toBe('');
    });
  });
});
