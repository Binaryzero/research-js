import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.js')>();
  return { ...actual, saveAppConfig: vi.fn() };
});

// Seed a known history so we can assert filter composition deterministically.
vi.mock('../src/history.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/history.js')>();
  return { ...actual, loadHistory: vi.fn(() => ({})) };
});

import { createServer } from '../src/index.js';
import { loadHistory } from '../src/history.js';
import type { FastifyInstance } from 'fastify';

describe('GET /api/history — filter composition', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = (await createServer()).fastify;
  });

  afterAll(async () => {
    await server.close();
  });

  it('applies search AND risk together instead of letting the last filter win', async () => {
    // Both entries are "Very Suspicious" (score 60); only one matches search=alpha.
    // The old code re-filtered the full history per block, so risk would have
    // re-admitted other.beta and returned both.
    vi.mocked(loadHistory).mockReturnValueOnce({
      'pub.alpha': { suspicion_score: 60, findings_count: 3, llm_analyzed: false, scan_date: '2026-07-01' },
      'other.beta': { suspicion_score: 60, findings_count: 2, llm_analyzed: false, scan_date: '2026-07-02' },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/history?search=alpha&risk=' + encodeURIComponent('Very Suspicious'),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Object.keys(body.scans)).toEqual(['pub.alpha']);
    expect(body.total).toBe(1);
  });

  it('composes risk AND llm filters', async () => {
    vi.mocked(loadHistory).mockReturnValueOnce({
      'p.high-llm': { suspicion_score: 60, llm_analyzed: true, scan_date: '2026-07-01' },
      'p.high-nollm': { suspicion_score: 60, llm_analyzed: false, scan_date: '2026-07-02' },
      'p.low-llm': { suspicion_score: 5, llm_analyzed: true, scan_date: '2026-07-03' },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/history?risk=' + encodeURIComponent('Very Suspicious') + '&llm=llm',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Object.keys(body.scans)).toEqual(['p.high-llm']);
  });
});
