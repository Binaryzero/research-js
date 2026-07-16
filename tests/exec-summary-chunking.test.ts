/**
 * The exec-summary chunker must split a source file that exceeds the chunk
 * budget INTO the budget — the old code passed an oversized file (a minified
 * bundle) whole, producing a request that overran the model's input context
 * and returned 400 Bad Request, so no summary was generated.
 */
import { describe, it, expect } from 'vitest';
import { splitOversizedSection } from '../src/analyzer/llm.js';

describe('splitOversizedSection', () => {
  it('returns the section unchanged when it fits', () => {
    expect(splitOversizedSection('small', 100)).toEqual(['small']);
  });

  it('never emits a sub-chunk larger than the budget', () => {
    const multiLine = Array.from({ length: 500 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const chunks = splitOversizedSection(multiLine, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
  });

  it('hard-slices a single line longer than the budget (minified bundle)', () => {
    const oneLine = 'a'.repeat(2_700_000); // ~2.7 MB, the size that 400'd
    const budget = 50_000;
    const chunks = splitOversizedSection(oneLine, budget);
    expect(chunks.length).toBe(Math.ceil(2_700_000 / budget));
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(budget);
    // No content is lost.
    expect(chunks.join('').length).toBe(2_700_000);
  });

  it('preserves all content across a mixed multi-line + minified section', () => {
    const section = ['header line', 'b'.repeat(120), 'footer'].join('\n');
    const chunks = splitOversizedSection(section, 50);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(50);
    // Every original character survives somewhere.
    const joined = chunks.join('');
    expect(joined).toContain('header line');
    expect(joined).toContain('b'.repeat(120));
    expect(joined).toContain('footer');
  });
});
