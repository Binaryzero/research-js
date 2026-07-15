/**
 * Context-window detection: the app must learn each model's real context window
 * (probe first, curated table as fallback, operator override on top) instead of
 * assuming a flat 32k.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseOllamaContextWindow,
  parseOpenAiContextWindow,
  lookupContextWindow,
  resolveContextWindow,
} from '../src/analyzer/model-context.js';

describe('parseOllamaContextWindow', () => {
  it('reads <architecture>.context_length from model_info', () => {
    const info = { 'general.architecture': 'glm5.2', 'glm5.2.context_length': 1_000_000 };
    expect(parseOllamaContextWindow(info)).toBe(1_000_000);
  });

  it('falls back to any *.context_length key when architecture is absent', () => {
    const info = { 'llama.context_length': 131_072 };
    expect(parseOllamaContextWindow(info)).toBe(131_072);
  });

  it('returns null for missing or non-positive values', () => {
    expect(parseOllamaContextWindow(undefined)).toBeNull();
    expect(parseOllamaContextWindow({})).toBeNull();
    expect(parseOllamaContextWindow({ 'llama.context_length': 0 })).toBeNull();
    expect(parseOllamaContextWindow({ 'llama.context_length': 'big' })).toBeNull();
  });
});

describe('parseOpenAiContextWindow', () => {
  it('reads max_model_len (vLLM) for the matching model id', () => {
    const payload = { data: [{ id: 'other', max_model_len: 4096 }, { id: 'qwen', max_model_len: 32_768 }] };
    expect(parseOpenAiContextWindow(payload, 'qwen')).toBe(32_768);
  });

  it('reads context_length (OpenRouter) when max_model_len is absent', () => {
    const payload = { data: [{ id: 'gpt', context_length: 128_000 }] };
    expect(parseOpenAiContextWindow(payload, 'gpt')).toBe(128_000);
  });

  it('returns null when the model is not listed or exposes no length', () => {
    expect(parseOpenAiContextWindow({ data: [{ id: 'a' }] }, 'a')).toBeNull();
    expect(parseOpenAiContextWindow({ data: [{ id: 'a', max_model_len: 4096 }] }, 'missing')).toBeNull();
    expect(parseOpenAiContextWindow({}, 'a')).toBeNull();
  });
});

describe('lookupContextWindow', () => {
  it('matches well-known hosted models', () => {
    expect(lookupContextWindow('gpt-4o-mini')).toBe(128_000);
    expect(lookupContextWindow('claude-sonnet-5')).toBe(200_000);
  });

  it('prefers the most specific match (llama3.2 vs llama3)', () => {
    expect(lookupContextWindow('llama3.2:latest')).toBe(131_072);
    expect(lookupContextWindow('llama3:8b')).toBe(8_192);
  });

  it('returns null for unknown models', () => {
    expect(lookupContextWindow('some-bespoke-model')).toBeNull();
  });
});

describe('resolveContextWindow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('honors an explicit override without probing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await resolveContextWindow({ provider: 'ollama', baseUrl: 'http://x', model: 'llama3.2', override: 65_536 });
    expect(res).toEqual({ contextWindow: 65_536, source: 'override' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('probes Ollama /api/show and reports source=probe', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ model_info: { 'general.architecture': 'llama', 'llama.context_length': 131_072 } }),
      { status: 200 },
    )));
    const res = await resolveContextWindow({ provider: 'ollama', baseUrl: 'http://x', model: 'llama3.2' });
    expect(res).toEqual({ contextWindow: 131_072, source: 'probe' });
  });

  it('falls back to the lookup table when the probe fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const res = await resolveContextWindow({ provider: 'ollama', baseUrl: 'http://x', model: 'gpt-4o' });
    expect(res).toEqual({ contextWindow: 128_000, source: 'lookup' });
  });

  it('returns unknown when probe fails and the model is not in the table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const res = await resolveContextWindow({ provider: 'ollama', baseUrl: 'http://x', model: 'mystery-model' });
    expect(res).toEqual({ contextWindow: null, source: 'unknown' });
  });
});
