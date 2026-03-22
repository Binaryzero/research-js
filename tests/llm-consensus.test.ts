/**
 * Tests for exported pure functions and constants from src/analyzer/llm.ts
 */

import { describe, it, expect } from 'vitest';
import {
  parseVerdictFromSummary,
  RISK_ORDER,
  RECOMMEND_ORDER,
} from '../src/analyzer/llm.js';

// ─── RISK_ORDER constant ────────────────────────────────────────

describe('RISK_ORDER', () => {
  it('maps critical to the highest value', () => {
    expect(RISK_ORDER['critical']).toBe(4);
  });

  it('maps none to the lowest value', () => {
    expect(RISK_ORDER['none']).toBe(0);
  });

  it('has correct ordering: critical > high > medium > low > none', () => {
    expect(RISK_ORDER['critical']).toBeGreaterThan(RISK_ORDER['high']);
    expect(RISK_ORDER['high']).toBeGreaterThan(RISK_ORDER['medium']);
    expect(RISK_ORDER['medium']).toBeGreaterThan(RISK_ORDER['low']);
    expect(RISK_ORDER['low']).toBeGreaterThan(RISK_ORDER['none']);
  });

  it('contains exactly 5 entries', () => {
    expect(Object.keys(RISK_ORDER)).toHaveLength(5);
  });
});

// ─── RECOMMEND_ORDER constant ───────────────────────────────────

describe('RECOMMEND_ORDER', () => {
  it('maps investigate to the highest value', () => {
    expect(RECOMMEND_ORDER['investigate']).toBe(2);
  });

  it('maps dismiss to the lowest value', () => {
    expect(RECOMMEND_ORDER['dismiss']).toBe(0);
  });

  it('has correct ordering: investigate > likely_benign > dismiss', () => {
    expect(RECOMMEND_ORDER['investigate']).toBeGreaterThan(RECOMMEND_ORDER['likely_benign']);
    expect(RECOMMEND_ORDER['likely_benign']).toBeGreaterThan(RECOMMEND_ORDER['dismiss']);
  });

  it('contains exactly 3 entries', () => {
    expect(Object.keys(RECOMMEND_ORDER)).toHaveLength(3);
  });
});

// ─── parseVerdictFromSummary ────────────────────────────────────

describe('parseVerdictFromSummary', () => {
  it('parses VERDICT: CLEAN from first line', () => {
    const result = parseVerdictFromSummary('VERDICT: CLEAN\nThis extension is safe.');
    expect(result.verdict).toBe('CLEAN');
    expect(result.prose).toBe('This extension is safe.');
  });

  it('parses VERDICT: SUSPICIOUS from first line', () => {
    const result = parseVerdictFromSummary('VERDICT: SUSPICIOUS\nSome concerns found.');
    expect(result.verdict).toBe('SUSPICIOUS');
    expect(result.prose).toBe('Some concerns found.');
  });

  it('parses VERDICT: MALICIOUS from first line', () => {
    const result = parseVerdictFromSummary('VERDICT: MALICIOUS\nThis extension is harmful.');
    expect(result.verdict).toBe('MALICIOUS');
    expect(result.prose).toBe('This extension is harmful.');
  });

  it('is case insensitive', () => {
    const result = parseVerdictFromSummary('verdict: clean\nAll good.');
    expect(result.verdict).toBe('CLEAN');
    expect(result.prose).toBe('All good.');
  });

  it('handles mixed case', () => {
    const result = parseVerdictFromSummary('Verdict: Malicious\nBad stuff.');
    expect(result.verdict).toBe('MALICIOUS');
  });

  it('defaults to SUSPICIOUS when no VERDICT line present', () => {
    const result = parseVerdictFromSummary('This is just a plain summary.');
    expect(result.verdict).toBe('SUSPICIOUS');
    expect(result.prose).toBe('This is just a plain summary.');
  });

  it('defaults to SUSPICIOUS for empty string', () => {
    const result = parseVerdictFromSummary('');
    expect(result.verdict).toBe('SUSPICIOUS');
    expect(result.prose).toBe('');
  });

  it('defaults to SUSPICIOUS for whitespace-only string', () => {
    const result = parseVerdictFromSummary('   \n  ');
    expect(result.verdict).toBe('SUSPICIOUS');
  });

  it('trims prose after removing verdict line', () => {
    const result = parseVerdictFromSummary('VERDICT: CLEAN\n\n  Prose with leading whitespace.\n');
    expect(result.verdict).toBe('CLEAN');
    expect(result.prose).toBe('Prose with leading whitespace.');
  });

  it('returns empty prose when only verdict line exists', () => {
    const result = parseVerdictFromSummary('VERDICT: SUSPICIOUS');
    expect(result.verdict).toBe('SUSPICIOUS');
    expect(result.prose).toBe('');
  });

  it('preserves multi-line prose', () => {
    const input = 'VERDICT: CLEAN\nLine one.\nLine two.\nLine three.';
    const result = parseVerdictFromSummary(input);
    expect(result.verdict).toBe('CLEAN');
    expect(result.prose).toContain('Line one.');
    expect(result.prose).toContain('Line two.');
    expect(result.prose).toContain('Line three.');
  });

  it('does not match VERDICT in non-first lines', () => {
    const input = 'Some preamble text\nVERDICT: CLEAN\nMore text.';
    const result = parseVerdictFromSummary(input);
    expect(result.verdict).toBe('SUSPICIOUS');
    expect(result.prose).toBe(input);
  });

  it('does not match invalid verdict values', () => {
    const result = parseVerdictFromSummary('VERDICT: UNKNOWN\nSome text.');
    expect(result.verdict).toBe('SUSPICIOUS');
    expect(result.prose).toBe('VERDICT: UNKNOWN\nSome text.');
  });
});
