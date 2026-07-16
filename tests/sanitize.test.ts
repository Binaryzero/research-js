/**
 * Source read from minified/binary bundles carries control bytes and U+FFFD
 * replacement chars. The Ollama-cloud /v1/responses endpoint rejects any request
 * containing them with a generic 400, which silently killed the executive
 * summary. The sanitizer must strip them while leaving real code intact.
 *
 * Control chars are written as \x.. / \u.... escapes on purpose so this stays a
 * plain-text file (literal NUL bytes would make git treat it as binary).
 */
import { describe, it, expect } from 'vitest';
import { sanitizeForLlm, sanitizeOptional } from '../src/providers/sanitize.js';

describe('sanitizeForLlm', () => {
  it('strips NUL and other C0 control chars', () => {
    const dirty = 'const a=1;\x00 const\x01 b=2;\x1f';
    expect(sanitizeForLlm(dirty)).toBe('const a=1; const b=2;');
  });

  it('preserves tab, newline, and carriage return', () => {
    const code = 'function f() {\n\treturn 1;\r\n}';
    expect(sanitizeForLlm(code)).toBe(code);
  });

  it('strips the U+FFFD replacement char (mis-decoded binary)', () => {
    expect(sanitizeForLlm('a��b')).toBe('ab');
  });

  it('strips DEL (U+007F) and lone surrogates', () => {
    expect(sanitizeForLlm('x\x7fy')).toBe('xy');
    expect(sanitizeForLlm('x\uD800y')).toBe('xy'); // lone high surrogate
    expect(sanitizeForLlm('x\uDC00y')).toBe('xy'); // lone low surrogate
  });

  it('keeps valid surrogate pairs (emoji) intact', () => {
    expect(sanitizeForLlm('ok \u{1F600} done')).toBe('ok \u{1F600} done');
  });

  it('keeps ordinary non-ASCII text', () => {
    expect(sanitizeForLlm('café — naïve')).toBe('café — naïve');
  });

  it('collapses a binary-heavy blob to just its readable characters', () => {
    // ~half control chars, like the real failing minified chunk.
    const blob = Array.from({ length: 1000 }, (_, i) => (i % 2 ? 'a' : '\x00')).join('');
    const clean = sanitizeForLlm(blob);
    expect(clean).toBe('a'.repeat(500));
    expect(/[\x00-\x08]/.test(clean)).toBe(false);
  });

  it('handles empty and passes undefined through sanitizeOptional', () => {
    expect(sanitizeForLlm('')).toBe('');
    expect(sanitizeOptional(undefined)).toBeUndefined();
    expect(sanitizeOptional('a\x00b')).toBe('ab');
  });
});
