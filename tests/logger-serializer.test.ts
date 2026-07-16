/**
 * The error serializer must keep AI SDK errors legible without dumping the
 * multi-megabyte request body (`requestBodyValues`) that pino's default
 * serializer would copy verbatim — that dump was the LLM-scan log spew.
 */
import { describe, it, expect } from 'vitest';
import { compactErrSerializer } from '../src/services/logger.js';

/** Shape of a real AI SDK AI_APICallError, trimmed to the fields we care about. */
function fakeApiCallError(promptChars: number) {
  const err = new Error('Bad Request') as Error & Record<string, unknown>;
  err.name = 'AI_APICallError';
  err.statusCode = 400;
  err.url = 'http://localhost:11434/v1/responses';
  err.responseBody = '{"error":"context length exceeded"}';
  // The payload pino would otherwise dump — the entire prompt.
  err.requestBodyValues = { input: [{ role: 'user', content: 'x'.repeat(promptChars) }] };
  err.responseHeaders = { 'set-cookie': 'a'.repeat(200) };
  return err;
}

describe('compactErrSerializer', () => {
  it('drops requestBodyValues (the multi-MB prompt) and responseHeaders', () => {
    const serialized = compactErrSerializer(fakeApiCallError(3_000_000)) as Record<string, unknown>;
    expect(serialized).not.toHaveProperty('requestBodyValues');
    expect(serialized).not.toHaveProperty('responseHeaders');
    // Whole thing must be tiny even though the source error held ~3 MB.
    expect(JSON.stringify(serialized).length).toBeLessThan(4000);
  });

  it('keeps the fields needed to diagnose the failure', () => {
    const serialized = compactErrSerializer(fakeApiCallError(1000)) as Record<string, unknown>;
    expect(serialized.type).toBe('AI_APICallError');
    expect(serialized.message).toBe('Bad Request');
    expect(serialized.statusCode).toBe(400);
    expect(serialized.url).toBe('http://localhost:11434/v1/responses');
    expect(serialized.responseBody).toContain('context length exceeded');
  });

  it('truncates an oversized responseBody', () => {
    const err = new Error('boom') as Error & Record<string, unknown>;
    err.responseBody = 'y'.repeat(5000);
    const serialized = compactErrSerializer(err) as Record<string, unknown>;
    expect(String(serialized.responseBody)).toContain('…[truncated]');
    expect(String(serialized.responseBody).length).toBeLessThan(1000);
  });

  it('passes non-object values through unchanged', () => {
    expect(compactErrSerializer('nope')).toBe('nope');
    expect(compactErrSerializer(null)).toBeNull();
    expect(compactErrSerializer(undefined)).toBeUndefined();
  });

  it('serializes an ordinary Error with type, message, and stack', () => {
    const serialized = compactErrSerializer(new Error('plain failure')) as Record<string, unknown>;
    expect(serialized.type).toBe('Error');
    expect(serialized.message).toBe('plain failure');
    expect(typeof serialized.stack).toBe('string');
  });
});
