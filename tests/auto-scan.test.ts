/**
 * The auto-scan scheduler: runs sweeps on the configured interval, skips
 * overlapping sweeps instead of stacking them, returns without waiting for
 * the whole batch scan, and stops cleanly when disabled.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutoScanScheduler, type SweepCandidate } from '../src/services/auto-scan.js';

function config(overrides: Record<string, unknown> = {}) {
  return { enabled: true, intervalMinutes: 60, count: 10, alertMinScore: 150, ...overrides };
}

describe('AutoScanScheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('runSweep scans only never-scanned extensions and reports the count', async () => {
    const started: SweepCandidate[][] = [];
    const scheduler = new AutoScanScheduler({
      findNewExtensions: async () => [{ extensionId: 'a.one' }, { extensionId: 'b.two' }],
      startSweep: async (exts) => { started.push(exts); },
    });
    scheduler.configure(config({ enabled: false }));

    const result = await scheduler.runSweep();
    expect(result).toEqual({ started: true, newCount: 2 });
    expect(started[0].map(e => e.extensionId)).toEqual(['a.one', 'b.two']);
  });

  it('returns before the batch scan finishes but holds the overlap guard', async () => {
    let releaseScan!: () => void;
    const scanDone = new Promise<void>(res => { releaseScan = res; });
    const scheduler = new AutoScanScheduler({
      findNewExtensions: async () => [{ extensionId: 'slow.ext' }],
      startSweep: () => scanDone, // long-running batch
    });
    scheduler.configure(config({ enabled: false }));

    const first = await scheduler.runSweep(); // resolves without waiting
    expect(first).toEqual({ started: true, newCount: 1 });
    expect(scheduler.isSweeping()).toBe(true);

    const second = await scheduler.runSweep(); // overlapping — skipped
    expect(second).toEqual({ started: false, newCount: 0 });

    releaseScan();
    await scanDone;
    await new Promise(res => setImmediate(res)); // let the .finally run
    expect(scheduler.isSweeping()).toBe(false);
  });

  it('a sweep with nothing new releases the guard immediately', async () => {
    const scheduler = new AutoScanScheduler({
      findNewExtensions: async () => [],
      startSweep: async () => { throw new Error('must not be called'); },
    });
    const result = await scheduler.runSweep();
    expect(result).toEqual({ started: true, newCount: 0 });
    expect(scheduler.isSweeping()).toBe(false);
  });

  it('configure(enabled) schedules sweeps on the interval; disabling stops them', async () => {
    vi.useFakeTimers();
    let sweeps = 0;
    const scheduler = new AutoScanScheduler({
      findNewExtensions: async () => { sweeps++; return []; },
      startSweep: async () => {},
    });

    scheduler.configure(config({ intervalMinutes: 10 }));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sweeps).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(sweeps).toBe(2);

    scheduler.configure(config({ enabled: false }));
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(sweeps).toBe(2); // no further runs
  });

  it('re-applying the SAME config does not reset the interval countdown', async () => {
    vi.useFakeTimers();
    let sweeps = 0;
    const scheduler = new AutoScanScheduler({
      findNewExtensions: async () => { sweeps++; return []; },
      startSweep: async () => {},
    });

    scheduler.configure(config({ intervalMinutes: 10 }));
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    // A save of unrelated settings re-posts the identical autoScan config.
    scheduler.configure(config({ intervalMinutes: 10 }));
    await vi.advanceTimersByTimeAsync(1 * 60_000);
    expect(sweeps).toBe(1); // countdown was NOT reset by the re-config
  });
});
