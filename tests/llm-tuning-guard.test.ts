import { describe, it, expect } from 'vitest';
import { positiveInt } from '../src/analyzer/llm.js';

// Guards tuning knobs (tier-A batch size, consensus votes) against bad values
// that could otherwise cause an infinite loop (batch size 0) or an empty
// vote count (from env typos / out-of-range config).
describe('positiveInt', () => {
  it('passes through valid positive integers', () => {
    expect(positiveInt(5, 3)).toBe(5);
    expect(positiveInt(1, 3)).toBe(1);
  });

  it('falls back to the default for 0, negatives, NaN, and undefined', () => {
    expect(positiveInt(0, 5)).toBe(5);       // would cause an infinite loop as a batch size
    expect(positiveInt(-2, 5)).toBe(5);
    expect(positiveInt(NaN, 3)).toBe(3);     // e.g. parseInt('abc', 10)
    expect(positiveInt(undefined, 3)).toBe(3);
  });

  it('floors fractional values', () => {
    expect(positiveInt(4.9, 3)).toBe(4);
  });
});
