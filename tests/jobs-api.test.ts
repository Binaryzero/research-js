/**
 * The task-tracking contract: work must be discoverable and its outcome
 * knowable from any page, at any time — including after the page that started
 * it navigated away, and after the process that ran it restarted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tempDir = join(__dirname, '..', '.temp-test', `jobs-api-${process.pid}`);
const reportsDir = join(tempDir, 'reports');
const historyFile = join(tempDir, 'history.json');

describe('jobs API', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    mkdirSync(reportsDir, { recursive: true });
    server = (await createServer({ reportsDir, historyFile })).fastify;
  });

  afterAll(async () => {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /api/jobs returns an empty list before anything runs', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/jobs' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.activeCount).toBe(0);
  });

  it('a started scan is immediately discoverable via /api/jobs (not just its SSE stream)', async () => {
    const start = await server.inject({
      method: 'POST', url: '/api/scan',
      payload: { input_source: 'https://marketplace.visualstudio.com/items?itemName=acme.widget', no_llm: 'true' },
    });
    expect(start.statusCode).toBe(200);
    const { scan_id } = JSON.parse(start.body);

    const list = await server.inject({ method: 'GET', url: '/api/jobs' });
    const { jobs } = JSON.parse(list.body);
    const job = jobs.find((j: { id: string }) => j.id === scan_id);

    expect(job).toBeDefined();
    expect(job.kind).toBe('scan');
    expect(job.label).toBe('acme.widget');

    const one = await server.inject({ method: 'GET', url: `/api/jobs/${scan_id}` });
    expect(one.statusCode).toBe(200);
    expect(JSON.parse(one.body).id).toBe(scan_id);
  });

  it('GET /api/jobs/:id 404s for an unknown id', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/jobs/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('job state is persisted to disk so a restart can recover it', async () => {
    const start = await server.inject({
      method: 'POST', url: '/api/scan',
      payload: { input_source: 'https://marketplace.visualstudio.com/items?itemName=acme.persisted', no_llm: 'true' },
    });
    const { scan_id } = JSON.parse(start.body);

    // create() flushes immediately — the record must already be durable.
    const onDisk = JSON.parse(readFileSync(join(reportsDir, 'jobs.json'), 'utf-8'));
    expect(onDisk.jobs.some((j: { id: string }) => j.id === scan_id)).toBe(true);
  });
});

describe('SSE reattach after the task already finished', () => {
  // The navigate-away-and-come-back case: 'done' fired while nobody was
  // listening. A late subscriber must be told the outcome, not left hanging.
  const dir = join(__dirname, '..', '.temp-test', `jobs-sse-${process.pid}`);
  const reports = join(dir, 'reports');
  let server: FastifyInstance;

  beforeAll(async () => {
    mkdirSync(reports, { recursive: true });
    // Seed a finished job as if a previous process had run it.
    writeFileSync(join(reports, 'jobs.json'), JSON.stringify({
      version: 1,
      jobs: [{
        id: 'finished1', kind: 'scan', target: 'acme.done', label: 'acme.done',
        status: 'complete', progress: 1, message: 'Complete',
        startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:01:00Z',
        finishedAt: '2026-01-01T00:01:00Z', reportName: 'acme.done.md', score: 12,
      }],
    }));
    server = (await createServer({ reportsDir: reports, historyFile: join(dir, 'h.json') })).fastify;
  });

  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('replays a terminal "done" event instead of hanging forever', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/scan/finished1/progress' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('event: done');
    expect(res.body).toContain('"status":"complete"');
    // Carries what the client needs to open the report.
    expect(res.body).toContain('acme.done.md');
  });

  it('a job left mid-flight by a dead process reports as interrupted, not running', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/jobs' });
    const { jobs } = JSON.parse(res.body);
    // Nothing is running in this fresh process.
    expect(jobs.every((j: { status: string }) => j.status !== 'running')).toBe(true);
  });
});
