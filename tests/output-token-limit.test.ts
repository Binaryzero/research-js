/**
 * The provider must learn each model's real output-token limit from the API's
 * own rejection ("maximum output tokens (N)") and retry with N — instead of the
 * caller guessing, which made every request 400 when Max Tokens was set to the
 * context window.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseMaxOutputTokens,
  withOutputLimit,
  getDetectedOutputLimit,
  rememberOutputLimit,
} from '../src/providers/output-token-limit.js';

describe('parseMaxOutputTokens', () => {
  it('extracts the limit from an AI SDK APICallError responseBody', () => {
    const err = {
      responseBody: '{"error":"max_tokens (1048576) exceeds model\'s maximum output tokens (65536) for model deepseek-v4-flash"}',
    };
    expect(parseMaxOutputTokens(err)).toBe(65536);
  });

  it('extracts from a plain message too', () => {
    expect(parseMaxOutputTokens({ message: 'max_tokens exceeds maximum output tokens (131072)' })).toBe(131072);
  });

  it('returns null for unrelated errors', () => {
    expect(parseMaxOutputTokens({ responseBody: '{"error":"model was retired"}' })).toBeNull();
    expect(parseMaxOutputTokens(new Error('Gone'))).toBeNull();
    expect(parseMaxOutputTokens(null)).toBeNull();
  });
});

describe('withOutputLimit', () => {
  const BASE = 'http://localhost:11434';

  beforeEach(() => {
    // Clear any learned limit between tests by re-seeding a fresh model name.
  });

  it('learns the limit from the rejection and retries once with it', async () => {
    const model = `learner-${Math.random()}`;
    const run = vi.fn(async (max: number) => {
      if (max > 65536) throw { responseBody: 'max_tokens (1048576) exceeds model\'s maximum output tokens (65536)' };
      return `ok@${max}`;
    });
    const out = await withOutputLimit(BASE, model, 1_048_576, run);
    expect(out).toBe('ok@65536');
    expect(run).toHaveBeenCalledTimes(2);          // first fails, retry succeeds
    expect(getDetectedOutputLimit(BASE, model)).toBe(65536); // cached
  });

  it('caps the first attempt at the cached limit on later calls (no failure)', async () => {
    const model = `cached-${Math.random()}`;
    rememberOutputLimit(BASE, model, 32768);
    const run = vi.fn(async (max: number) => `ok@${max}`);
    const out = await withOutputLimit(BASE, model, 1_000_000, run);
    expect(out).toBe('ok@32768');                  // clamped to cache up front
    expect(run).toHaveBeenCalledTimes(1);          // no retry needed
  });

  it('rethrows unrelated errors without retrying', async () => {
    const model = `err-${Math.random()}`;
    const run = vi.fn(async () => { throw new Error('Gone'); });
    await expect(withOutputLimit(BASE, model, 4096, run)).rejects.toThrow('Gone');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
