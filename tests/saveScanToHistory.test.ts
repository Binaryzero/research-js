import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { saveScanToHistory } from '../src/index.js';

describe('saveScanToHistory', () => {
  let dir: string;
  let historyPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'save-history-test-'));
    historyPath = join(dir, 'history.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('correctly saves scan to history when file does not exist', async () => {
    const entry = { score: 10, scan_date: new Date().toISOString() };
    await saveScanToHistory(historyPath, 'test-ext', entry);

    expect(existsSync(historyPath)).toBe(true);
    const content = JSON.parse(readFileSync(historyPath, 'utf-8'));
    expect(content.scans['test-ext']).toEqual(entry);
  });

  it('preserves existing entries', async () => {
    const existing = {
      scans: {
        'old-ext': { score: 5, scan_date: '2023-01-01' }
      },
      last_updated: '2023-01-01'
    };
    const { writeFileSync } = await import('fs');
    writeFileSync(historyPath, JSON.stringify(existing));

    const entry = { score: 10, scan_date: new Date().toISOString() };
    await saveScanToHistory(historyPath, 'new-ext', entry);

    const content = JSON.parse(readFileSync(historyPath, 'utf-8'));
    expect(content.scans['old-ext']).toEqual(existing.scans['old-ext']);
    expect(content.scans['new-ext']).toEqual(entry);
  });
});
