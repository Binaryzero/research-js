/**
 * The server applies a global per-IP rate limit to every route, so the
 * file-system-touching API handlers can't be hammered (CodeQL
 * js/missing-rate-limiting). The limit is configurable; the production default
 * is high enough that normal single-user traffic never trips it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tempDir = join(__dirname, '..', '.temp-test', `rate-limit-${process.pid}`);
const reportsDir = join(tempDir, 'reports');
const historyFile = join(tempDir, 'history.json');

const MAX = 3;

describe('global rate limiting', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    mkdirSync(reportsDir, { recursive: true });
    server = (await createServer({
      reportsDir,
      historyFile,
      rateLimit: { max: MAX, timeWindowMs: 60_000 },
    })).fastify;
  });

  afterAll(async () => {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('advertises the limit via standard headers', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/jobs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe(String(MAX));
    // First request in the window: one consumed, MAX-1 remaining.
    expect(res.headers['x-ratelimit-remaining']).toBe(String(MAX - 1));
  });

  it('allows traffic up to the limit, then returns 429 for the burst over it', async () => {
    // Fresh server so this test owns the whole window (the header test above
    // already consumed one slot on the shared server).
    const isolated = (await createServer({
      reportsDir,
      historyFile,
      rateLimit: { max: MAX, timeWindowMs: 60_000 },
    })).fastify;
    try {
      for (let i = 0; i < MAX; i++) {
        const ok = await isolated.inject({ method: 'GET', url: '/api/jobs' });
        expect(ok.statusCode).toBe(200);
      }
      const overLimit = await isolated.inject({ method: 'GET', url: '/api/jobs' });
      expect(overLimit.statusCode).toBe(429);
      expect(overLimit.headers['retry-after']).toBeDefined();
    } finally {
      await isolated.close();
    }
  });
});
