import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { JobStore } from '../src/services/job-store.js';

describe('JobStore', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobstore-'));
    path = join(dir, 'jobs.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates a job and exposes it via get/list', () => {
    const store = new JobStore(path);
    const job = store.create({ id: 'j1', kind: 'scan', target: 'acme.widget', label: 'acme.widget' });

    expect(job.status).toBe('pending');
    expect(job.progress).toBe(0);
    expect(store.get('j1')?.target).toBe('acme.widget');
    expect(store.list()).toHaveLength(1);
  });

  it('updates status/progress and stamps finishedAt on terminal transitions', async () => {
    const store = new JobStore(path);
    store.create({ id: 'j1', kind: 'scan', target: 't', label: 't' });

    store.update('j1', { status: 'running', progress: 0.5, message: 'halfway' });
    expect(store.get('j1')?.finishedAt).toBeUndefined();

    store.update('j1', { status: 'complete', progress: 1, reportName: 't.md' });
    const done = store.get('j1')!;
    expect(done.status).toBe('complete');
    expect(done.finishedAt).toBeTruthy();
    expect(done.reportName).toBe('t.md');
  });

  it('persists to disk and reloads', async () => {
    const store = new JobStore(path);
    store.create({ id: 'j1', kind: 'scan', target: 'acme.widget', label: 'acme.widget' });
    store.update('j1', { status: 'complete', progress: 1 });
    await store.flush();

    const reloaded = new JobStore(path);
    reloaded.load();
    expect(reloaded.get('j1')?.status).toBe('complete');
    expect(reloaded.get('j1')?.target).toBe('acme.widget');
  });

  it('marks in-flight jobs interrupted on boot (server died mid-scan)', async () => {
    const store = new JobStore(path);
    store.create({ id: 'running', kind: 'scan', target: 'a', label: 'a' });
    store.update('running', { status: 'running', progress: 0.3 });
    store.create({ id: 'pending', kind: 'scan', target: 'b', label: 'b' });
    store.create({ id: 'done', kind: 'scan', target: 'c', label: 'c' });
    store.update('done', { status: 'complete', progress: 1 });
    await store.flush();

    // Simulate restart
    const rebooted = new JobStore(path);
    rebooted.load();

    expect(rebooted.get('running')?.status).toBe('interrupted');
    expect(rebooted.get('pending')?.status).toBe('interrupted');
    expect(rebooted.get('done')?.status).toBe('complete'); // terminal untouched
    expect(rebooted.get('running')?.error).toMatch(/interrupted/i);
  });

  it('lists active jobs separately from terminal ones', () => {
    const store = new JobStore(path);
    store.create({ id: 'a', kind: 'scan', target: 'a', label: 'a' });
    store.update('a', { status: 'running' });
    store.create({ id: 'b', kind: 'scan', target: 'b', label: 'b' });
    store.update('b', { status: 'complete' });

    expect(store.listActive().map(j => j.id)).toEqual(['a']);
    expect(store.list().map(j => j.id).sort()).toEqual(['a', 'b']);
  });

  it('prunes oldest terminal jobs beyond the retention cap, keeping active ones', async () => {
    const store = new JobStore(path, { maxTerminal: 2 });
    for (const id of ['t1', 't2', 't3', 't4']) {
      store.create({ id, kind: 'scan', target: id, label: id });
      store.update(id, { status: 'complete' });
    }
    store.create({ id: 'live', kind: 'scan', target: 'live', label: 'live' });
    store.update('live', { status: 'running' });

    store.prune();

    // Active job always survives; only the 2 most recent terminal jobs remain.
    expect(store.get('live')).toBeDefined();
    const terminal = store.list().filter(j => j.status === 'complete').map(j => j.id);
    expect(terminal).toHaveLength(2);
    expect(terminal).toContain('t4');
    expect(store.get('t1')).toBeUndefined();
  });

  it('does not flush on a status-less progress update (throttle intact)', async () => {
    const store = new JobStore(path);
    store.create({ id: 'j1', kind: 'scan', target: 't', label: 't' });
    store.update('j1', { status: 'running', progress: 0.1 }); // transition → flush
    await store.flush();
    const mtimeAfterStart = readFileSync(path, 'utf-8');

    // A pure progress tick marks dirty but must not synchronously rewrite disk.
    store.update('j1', { progress: 0.2, message: 'more' });
    expect(readFileSync(path, 'utf-8')).toBe(mtimeAfterStart); // unchanged on disk
    expect(store.get('j1')?.progress).toBe(0.2); // but live state advanced
  });

  it('a repeated running status does not re-flush every tick', async () => {
    const store = new JobStore(path);
    store.create({ id: 'j1', kind: 'scan', target: 't', label: 't' });
    store.update('j1', { status: 'running', progress: 0.1 });
    await store.flush();
    const snapshot = readFileSync(path, 'utf-8');

    // emitProgress always passes status:'running'; a same-status write must not flush.
    store.update('j1', { status: 'running', progress: 0.5, message: 'x' });
    expect(readFileSync(path, 'utf-8')).toBe(snapshot);
  });

  it('a finished job cannot be resurrected or reclassified (first terminal wins)', () => {
    const store = new JobStore(path);
    store.create({ id: 'j1', kind: 'scan', target: 't', label: 't' });
    store.update('j1', { status: 'cancelled', message: 'Cancelled' });

    // A late failure (post-cancel worker rejection) must not flip it to failed.
    store.update('j1', { status: 'failed', error: 'Scan cancelled' });
    expect(store.get('j1')?.status).toBe('cancelled');

    // A stray progress tick must not resurrect it to running.
    store.update('j1', { status: 'running', progress: 0.5 });
    expect(store.get('j1')?.status).toBe('cancelled');
  });

  it('survives a corrupt jobs file instead of crashing the server', () => {
    writeFileSync(path, '{ not valid json');
    const store = new JobStore(path);

    expect(() => store.load()).not.toThrow();
    expect(store.list()).toEqual([]);
  });

  it('writes atomically (no partial file visible)', async () => {
    const store = new JobStore(path);
    store.create({ id: 'j1', kind: 'scan', target: 'a', label: 'a' });
    await store.flush();

    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(parsed.jobs).toHaveLength(1);
  });
});
