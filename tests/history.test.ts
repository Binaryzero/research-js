import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadHistory, updateHistory, saveHistory } from '../src/history.js';

describe('history serialization', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'history-test-'));
    path = join(dir, 'scan_history.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loadHistory returns empty object when file missing', () => {
    expect(loadHistory(path)).toEqual({});
  });

  it('updateHistory preserves all writes under concurrent calls', async () => {
    const N = 20;
    const writes = Array.from({ length: N }, (_, i) =>
      updateHistory(path, scans => {
        scans[`ext-${i}`] = { suspicion_score: i };
      }),
    );
    await Promise.all(writes);

    const result = loadHistory(path);
    expect(Object.keys(result)).toHaveLength(N);
    for (let i = 0; i < N; i++) {
      expect(result[`ext-${i}`]).toEqual({ suspicion_score: i });
    }
  });

  it('a rejecting mutator does not poison the queue', async () => {
    await updateHistory(path, scans => {
      scans['first'] = { ok: true };
    });

    const failure = updateHistory(path, () => {
      throw new Error('boom');
    });
    await expect(failure).rejects.toThrow('boom');

    // Subsequent write must still succeed
    await updateHistory(path, scans => {
      scans['second'] = { ok: true };
    });

    const result = loadHistory(path);
    expect(result.first).toEqual({ ok: true });
    expect(result.second).toEqual({ ok: true });
  });

  it('writes are atomic: no .tmp file remains after success', async () => {
    await updateHistory(path, scans => {
      scans['x'] = { v: 1 };
    });
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(existsSync(path)).toBe(true);
  });

  it('saveHistory overwrites the file and serializes with updates', async () => {
    await updateHistory(path, scans => {
      scans['a'] = { v: 1 };
    });
    const both = Promise.all([
      saveHistory(path, { only: { v: 99 } }),
      updateHistory(path, scans => {
        scans['after'] = { v: 2 };
      }),
    ]);
    await both;
    const result = loadHistory(path);
    // The update queued after save must see the cleared state
    expect(result).toEqual({ only: { v: 99 }, after: { v: 2 } });
  });

  it('on-disk format keeps {scans, last_updated} envelope', async () => {
    await updateHistory(path, scans => {
      scans['x'] = { v: 1 };
    });
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    expect(raw.scans).toEqual({ x: { v: 1 } });
    expect(typeof raw.last_updated).toBe('string');
  });
});
