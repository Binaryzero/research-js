import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Keep POST /api/config from touching the real config (mirrors api.test.ts).
vi.mock('../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.js')>();
  return { ...actual, saveAppConfig: vi.fn() };
});

// Control the marketplace client and history loader so we can drive the
// error/degradation paths of POST /api/search without real network or files.
vi.mock('../src/services/marketplace.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/marketplace.js')>();
  return { ...actual, searchExtensions: vi.fn() };
});
vi.mock('../src/history.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/history.js')>();
  return { ...actual, loadHistory: vi.fn(() => ({})) };
});

import { createServer } from '../src/index.js';
import { searchExtensions, type MarketplaceExtension } from '../src/services/marketplace.js';
import { loadHistory } from '../src/history.js';
import type { FastifyInstance } from 'fastify';

const searchPayload = { search_text: 'python', page: 1, page_size: 5 };

describe('POST /api/search — blocker regressions', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = (await createServer()).fastify;
  });

  afterAll(async () => {
    await server.close();
  });

  it('surfaces the real upstream error instead of a generic 500', async () => {
    // Regression: the handler used to swallow the cause behind
    // "Marketplace search failed", which made the broken-search bug undiagnosable.
    vi.mocked(searchExtensions).mockRejectedValueOnce(new Error('Marketplace API error: 503'));

    const response = await server.inject({
      method: 'POST',
      url: '/api/search',
      headers: { 'content-type': 'application/json' },
      payload: searchPayload,
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toContain('Marketplace API error: 503');
  });

  it('returns an array-shaped results field on success', async () => {
    vi.mocked(searchExtensions).mockResolvedValueOnce([]);

    const response = await server.inject({
      method: 'POST',
      url: '/api/search',
      headers: { 'content-type': 'application/json' },
      payload: searchPayload,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.results)).toBe(true);
  });

  it('degrades to un-augmented results when the history file is corrupt', async () => {
    // Regression: a corrupt scan_history.json (loadHistory now throws on parse
    // failure) must not blank the whole search with a 500.
    vi.mocked(searchExtensions).mockResolvedValueOnce([
      { extensionId: 'pub.ext' } as unknown as MarketplaceExtension,
    ]);
    vi.mocked(loadHistory).mockImplementationOnce(() => {
      throw new Error('Failed to parse history file');
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/search',
      headers: { 'content-type': 'application/json' },
      payload: searchPayload,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].scan).toBeUndefined();
  });
});
