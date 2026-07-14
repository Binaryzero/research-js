import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StaticAnalyzer } from '../src/analyzer/static.js';
import { runStaticAnalysis, ScanCancelledError, ScanTimeoutError } from '../src/analyzer/static-runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '.temp-test', `static-worker-${process.pid}`);

describe('static analysis in a worker thread', () => {
  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'worker-test', publisher: 'tester', version: '1.0.0',
      description: 'fixture', engines: { vscode: '^1.0.0' },
    }));
    writeFileSync(join(testDir, 'extension.js'), `
      const cp = require('child_process');
      cp.exec('git status');
      fetch('https://api.example.com/data');
      const key = "sk-1234567890abcdefghij";
      eval(userInput);
    `);
  });

  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('produces the same result as running inline (parity)', async () => {
    const inline = await new StaticAnalyzer(testDir, { verbose: false }).analyze();
    const viaWorker = await runStaticAnalysis(testDir, { verbose: false });

    expect(viaWorker.extensionId).toBe(inline.extensionId);
    expect(viaWorker.findings.length).toBe(inline.findings.length);
    expect(viaWorker.endpoints.length).toBe(inline.endpoints.length);
    expect(viaWorker.totalSize).toBe(inline.totalSize);
    // Findings must survive the structured clone intact, not just in count.
    expect(viaWorker.findings.map(f => f.patternName).sort())
      .toEqual(inline.findings.map(f => f.patternName).sort());
  }, 30_000);

  it('reports phase progress from inside the worker', async () => {
    const seen: Array<{ fraction: number; message: string }> = [];
    await runStaticAnalysis(testDir, {
      onProgress: (fraction, message) => seen.push({ fraction, message }),
    });

    expect(seen.length).toBeGreaterThan(2);
    // Monotonic, bounded 0..1
    for (const p of seen) {
      expect(p.fraction).toBeGreaterThanOrEqual(0);
      expect(p.fraction).toBeLessThanOrEqual(1);
    }
    expect(seen.map(p => p.fraction)).toEqual([...seen.map(p => p.fraction)].sort((a, b) => a - b));
    expect(seen.some(p => /pattern/i.test(p.message))).toBe(true);
  }, 30_000);

  it('cancels via AbortSignal instead of running to completion', async () => {
    const controller = new AbortController();
    const promise = runStaticAnalysis(testDir, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(ScanCancelledError);
  }, 30_000);

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(runStaticAnalysis(testDir, { signal: controller.signal }))
      .rejects.toBeInstanceOf(ScanCancelledError);
  });

  it('surfaces analyzer errors raised inside the worker', async () => {
    // A missing patterns file makes the analyzer throw during construction;
    // the failure must cross the thread boundary and reject, not hang.
    await expect(
      runStaticAnalysis(testDir, { patternsFile: join(testDir, 'no-such-patterns.yaml') }),
    ).rejects.toThrow();
  }, 30_000);

  it('returns an empty-but-valid result for a nonexistent path (caller guards this)', async () => {
    // Documents real behavior: analyze() does not throw here, which is why the
    // scan pipeline explicitly refuses to persist a zero-file result.
    const result = await runStaticAnalysis(join(testDir, 'does-not-exist'));
    expect(result.findings).toEqual([]);
    expect(result.totalSize).toBe(0);
  }, 30_000);

  it('terminates a worker that exceeds the timeout (wedged-regex kill switch)', async () => {
    // A patterns file with a catastrophically backtracking regex would pin the
    // worker forever; a tiny timeout must terminate it and reject, not hang.
    const evilPatterns = join(testDir, 'evil-patterns.yaml');
    writeFileSync(evilPatterns, [
      'version: "1.0"',
      'code_execution:',
      '  redos:',
      '    pattern: "(a+)+$"',
      '    flags: ""',
      '    description: catastrophic backtracker',
      '    risk: high',
    ].join('\n'));
    // Give the analyzer input that makes (a+)+$ blow up.
    writeFileSync(join(testDir, 'redos-bait.js'), 'const x = "' + 'a'.repeat(50) + '!";');

    const start = Date.now();
    await expect(
      runStaticAnalysis(testDir, { patternsFile: evilPatterns, timeoutMs: 1500 }),
    ).rejects.toBeInstanceOf(ScanTimeoutError);
    // It actually stopped near the timeout, not after finishing the ReDoS.
    expect(Date.now() - start).toBeLessThan(8000);
  }, 30_000);

  it('does not block the event loop while analyzing', async () => {
    // The whole point: the main thread must keep servicing timers (and therefore
    // SSE keepalives / HTTP requests) while the scan runs.
    let ticks = 0;
    const ticker = setInterval(() => { ticks++; }, 5);

    await runStaticAnalysis(testDir, { verbose: false });
    clearInterval(ticker);

    expect(ticks).toBeGreaterThan(0);
  }, 30_000);
});
