/**
 * High-risk alerts must persist across restarts, deduplicate per extension
 * version (no re-nagging on re-scan), and stay visible until acknowledged.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AlertStore } from '../src/services/alerts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tempDir = join(__dirname, '..', '.temp-test', `alerts-${process.pid}`);

function input(overrides: Record<string, unknown> = {}) {
  return {
    extensionId: 'bad.actor',
    version: '1.0.0',
    score: 480,
    riskLabel: 'Very Suspicious',
    reportName: 'bad.actor.md',
    topFindings: ['Obfuscated eval', 'Credential exfiltration'],
    ...overrides,
  };
}

describe('AlertStore', () => {
  let store: AlertStore;
  let path: string;
  let n = 0;

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
    path = join(tempDir, `alerts-${n++}.json`);
    store = new AlertStore(path);
    store.load();
  });

  afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

  it('raises an alert and counts it as unacknowledged', () => {
    const alert = store.raise(input());
    expect(alert).not.toBeNull();
    expect(alert?.score).toBe(480);
    expect(store.unacknowledgedCount()).toBe(1);
  });

  it('deduplicates the same extension version but alerts a NEW version', () => {
    expect(store.raise(input())).not.toBeNull();
    expect(store.raise(input())).toBeNull(); // same version re-scanned
    expect(store.raise(input({ version: '1.0.1' }))).not.toBeNull();
    expect(store.list()).toHaveLength(2);
  });

  it('acknowledge clears one; ack-all clears the rest', () => {
    const a = store.raise(input())!;
    store.raise(input({ extensionId: 'other.ext' }));
    store.raise(input({ extensionId: 'third.ext' }));

    expect(store.acknowledge(a.id)).toBe(true);
    expect(store.unacknowledgedCount()).toBe(2);
    expect(store.acknowledgeAll()).toBe(2);
    expect(store.unacknowledgedCount()).toBe(0);
    expect(store.acknowledge('missing')).toBe(false);
  });

  it('persists to disk and reloads', () => {
    store.raise(input());
    const reloaded = new AlertStore(path);
    reloaded.load();
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.unacknowledgedCount()).toBe(1);
  });
});
