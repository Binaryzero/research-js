/**
 * /api/logs exposes the in-memory log buffer to the UI (the /logs page), and
 * the logger must actually feed that buffer — the whole point is seeing the
 * REAL application log in the browser, not a curated snippet.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from '../src/index.js';
import { getComponentLogger } from '../src/services/logger.js';
import { clearLogBuffer } from '../src/services/log-buffer.js';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tempDir = join(__dirname, '..', '.temp-test', `logs-api-${process.pid}`);
const reportsDir = join(tempDir, 'reports');
const historyFile = join(tempDir, 'history.json');

interface LogsResponse {
  entries: Array<{ seq: number; level: string; component: string; msg: string }>;
  lastSeq: number;
  components: string[];
}

describe('/api/logs', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    mkdirSync(reportsDir, { recursive: true });
    server = (await createServer({ reportsDir, historyFile })).fastify;
  });

  afterAll(async () => {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns records the application logger emitted', async () => {
    clearLogBuffer();
    getComponentLogger('TestComp').info('logs-api probe message');

    const res = await server.inject({ method: 'GET', url: '/api/logs' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as LogsResponse;

    const probe = body.entries.find((e) => e.msg === 'logs-api probe message');
    expect(probe).toBeDefined();
    expect(probe?.component).toBe('TestComp');
    expect(body.components).toContain('TestComp');
    expect(body.lastSeq).toBeGreaterThan(0);
  });

  it('supports the since cursor for incremental polling', async () => {
    clearLogBuffer();
    getComponentLogger('TestComp').info('first');
    const first = (await server.inject({ method: 'GET', url: '/api/logs' })).json() as LogsResponse;

    getComponentLogger('TestComp').info('second');
    const next = (
      await server.inject({ method: 'GET', url: `/api/logs?since=${first.lastSeq}` })
    ).json() as LogsResponse;

    expect(next.entries.map((e) => e.msg)).toEqual(['second']);
  });

  it('filters by level and component', async () => {
    clearLogBuffer();
    getComponentLogger('Alpha').info('quiet info');
    getComponentLogger('Beta').warn('loud warning');

    const warns = (
      await server.inject({ method: 'GET', url: '/api/logs?level=warn' })
    ).json() as LogsResponse;
    expect(warns.entries.map((e) => e.msg)).toEqual(['loud warning']);

    const alpha = (
      await server.inject({ method: 'GET', url: '/api/logs?component=Alpha' })
    ).json() as LogsResponse;
    expect(alpha.entries.map((e) => e.msg)).toEqual(['quiet info']);
  });

  it('serves the /logs page', async () => {
    const res = await server.inject({ method: 'GET', url: '/logs' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('log-output');
  });
});
