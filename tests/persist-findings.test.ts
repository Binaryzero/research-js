/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadPersistedResult } from '../src/index.js';
import type { AnalysisResult } from '../src/types/index.js';

// loadPersistedResult is the load half of the "persist findings so LLM
// re-analysis reuses them instead of re-scanning" feature.
describe('loadPersistedResult', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'persist-findings-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writePersisted(extensionId: string, result: Partial<AnalysisResult>): void {
    const safeName = extensionId.replace(/[<>:"/\\|?*]/g, '_');
    writeFileSync(join(dir, `${safeName}.json`), JSON.stringify(result));
  }

  it('round-trips a persisted result by extension id', () => {
    writePersisted('pub.ext', { extensionId: 'pub.ext', findings: [{ title: 'X' } as never] });
    const loaded = loadPersistedResult(dir, 'pub.ext');
    expect(loaded).not.toBeNull();
    expect(loaded!.extensionId).toBe('pub.ext');
    expect(loaded!.findings).toHaveLength(1);
  });

  it('returns null when no persisted result exists', () => {
    expect(loadPersistedResult(dir, 'never.scanned')).toBeNull();
  });

  it('returns null (does not throw) on a corrupt file', () => {
    const safeName = 'pub.corrupt';
    writeFileSync(join(dir, `${safeName}.json`), '{ not valid json');
    expect(loadPersistedResult(dir, 'pub.corrupt')).toBeNull();
  });

  it('returns null when the JSON has no findings array', () => {
    writeFileSync(join(dir, 'pub.noshape.json'), JSON.stringify({ extensionId: 'pub.noshape' }));
    expect(loadPersistedResult(dir, 'pub.noshape')).toBeNull();
  });
});
