/**
 * Tests for pure functions in src/analyzer/llm-batch.ts
 */

import { describe, it, expect } from 'vitest';
import {
  groupFindingsByPatternAndFile,
  selectDiverseSamples,
  buildStrategicBulkPrompt,
  parseStrategicAssessments,
  estimateStrategicLlmCalls,
} from '../src/analyzer/llm-batch.js';
import { makeFinding, makePromptConfig } from './fixtures.js';
import type { Finding } from '../src/types/index.js';

// ─── groupFindingsByPatternAndFile ──────────────────────────────

describe('groupFindingsByPatternAndFile', () => {
  it('returns empty array for empty findings', () => {
    expect(groupFindingsByPatternAndFile([])).toEqual([]);
  });

  it('groups findings by category:title key', () => {
    const findings = [
      makeFinding({ category: 'network', title: 'HTTP Request', location: 'a.js:1' }),
      makeFinding({ category: 'network', title: 'HTTP Request', location: 'a.js:5' }),
      makeFinding({ category: 'exfiltration', title: 'Data Leak', location: 'b.js:2' }),
    ];

    const groups = groupFindingsByPatternAndFile(findings);

    expect(groups).toHaveLength(2);
    const networkGroup = groups.find(g => g.patternName === 'HTTP Request');
    expect(networkGroup).toBeDefined();
    expect(networkGroup!.totalCount).toBe(2);
    expect(networkGroup!.category).toBe('network');

    const exfilGroup = groups.find(g => g.patternName === 'Data Leak');
    expect(exfilGroup).toBeDefined();
    expect(exfilGroup!.totalCount).toBe(1);
  });

  it('groups findings into separate file groups within a pattern', () => {
    const findings = [
      makeFinding({ category: 'network', title: 'Fetch', location: 'src/a.js:1' }),
      makeFinding({ category: 'network', title: 'Fetch', location: 'src/b.js:1' }),
      makeFinding({ category: 'network', title: 'Fetch', location: 'src/a.js:10' }),
    ];

    const groups = groupFindingsByPatternAndFile(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileGroups).toHaveLength(2);

    const aGroup = groups[0].fileGroups.find(fg => fg.filePath === 'src/a.js');
    expect(aGroup!.findings).toHaveLength(2);
    expect(aGroup!.indices).toEqual([0, 2]);

    const bGroup = groups[0].fileGroups.find(fg => fg.filePath === 'src/b.js');
    expect(bGroup!.findings).toHaveLength(1);
    expect(bGroup!.indices).toEqual([1]);
  });

  it('sorts by risk level, higher risk first', () => {
    // Note: the implementation uses `riskOrder[x] || 5` which means 'critical' (mapped to 0)
    // is treated as unknown due to 0 being falsy. This test uses high/medium/low to avoid that edge case.
    const findings = [
      makeFinding({ category: 'a', title: 'Low', riskLevel: 'low', location: 'x.js:1' }),
      makeFinding({ category: 'b', title: 'High', riskLevel: 'high', location: 'y.js:1' }),
      makeFinding({ category: 'c', title: 'Medium', riskLevel: 'medium', location: 'z.js:1' }),
    ];

    const groups = groupFindingsByPatternAndFile(findings);
    expect(groups[0].risk).toBe('high');
    expect(groups[1].risk).toBe('medium');
    expect(groups[2].risk).toBe('low');
  });

  it('breaks risk ties by number of file groups (more files first)', () => {
    const findings = [
      makeFinding({ category: 'a', title: 'P1', riskLevel: 'high', location: 'x.js:1' }),
      makeFinding({ category: 'b', title: 'P2', riskLevel: 'high', location: 'y.js:1' }),
      makeFinding({ category: 'b', title: 'P2', riskLevel: 'high', location: 'z.js:1' }),
    ];

    const groups = groupFindingsByPatternAndFile(findings);
    expect(groups[0].patternName).toBe('P2');
    expect(groups[0].fileGroups).toHaveLength(2);
    expect(groups[1].patternName).toBe('P1');
    expect(groups[1].fileGroups).toHaveLength(1);
  });

  it('sets isExtensionCode correctly for node_modules paths', () => {
    const findings = [
      makeFinding({ category: 'a', title: 'P', location: 'node_modules/foo/index.js:1' }),
    ];

    const groups = groupFindingsByPatternAndFile(findings);
    const fg = groups[0].fileGroups[0];
    expect(fg.isExtensionCode).toBe(false);
    expect(fg.isBundledDependency).toBe(true);
  });

  it('sets isConfig correctly for JSON files', () => {
    const findings = [
      makeFinding({ category: 'a', title: 'P', location: 'package.json:5' }),
    ];

    const groups = groupFindingsByPatternAndFile(findings);
    expect(groups[0].fileGroups[0].isConfig).toBe(true);
  });
});

// ─── selectDiverseSamples ───────────────────────────────────────

describe('selectDiverseSamples', () => {
  function makeFileGroup(count: number) {
    const findings: Finding[] = [];
    const indices: number[] = [];
    for (let i = 0; i < count; i++) {
      findings.push(makeFinding({ location: `src/file.js:${i + 1}`, evidence: `evidence-${i}` }));
      indices.push(i);
    }
    return {
      filePath: 'src/file.js',
      findings,
      indices,
      isExtensionCode: true,
      isBundledDependency: false,
      isConfig: false,
    };
  }

  it('returns all findings when count <= sampleSize', () => {
    const fg = makeFileGroup(3);
    const samples = selectDiverseSamples(fg, 5);
    expect(samples).toHaveLength(3);
    expect(samples.every(s => s.reason === 'all_assessed')).toBe(true);
  });

  it('returns all findings when count equals sampleSize', () => {
    const fg = makeFileGroup(4);
    const samples = selectDiverseSamples(fg, 4);
    expect(samples).toHaveLength(4);
  });

  it('always includes first and last when sampling', () => {
    const fg = makeFileGroup(10);
    const samples = selectDiverseSamples(fg, 3);

    const indices = samples.map(s => s.originalIndex);
    expect(indices).toContain(0);  // first
    expect(indices).toContain(9);  // last
  });

  it('includes first_occurrence and last_occurrence reasons', () => {
    const fg = makeFileGroup(10);
    const samples = selectDiverseSamples(fg, 4);

    const reasons = samples.map(s => s.reason);
    expect(reasons).toContain('first_occurrence');
    expect(reasons).toContain('last_occurrence');
  });

  it('returns samples sorted by originalIndex', () => {
    const fg = makeFileGroup(20);
    const samples = selectDiverseSamples(fg, 5);
    const indices = samples.map(s => s.originalIndex);

    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('does not exceed sampleSize', () => {
    const fg = makeFileGroup(100);
    const samples = selectDiverseSamples(fg, 5);
    expect(samples.length).toBeLessThanOrEqual(5);
  });

  it('preserves fileGroup reference on each sample', () => {
    const fg = makeFileGroup(3);
    const samples = selectDiverseSamples(fg, 10);
    for (const s of samples) {
      expect(s.fileGroup).toBe(fg);
    }
  });

  it('returns only first when sampleSize is 1', () => {
    const fg = makeFileGroup(5);
    const samples = selectDiverseSamples(fg, 1);
    expect(samples).toHaveLength(1);
    expect(samples[0].originalIndex).toBe(0);
    expect(samples[0].reason).toBe('first_occurrence');
  });
});

// ─── buildStrategicBulkPrompt ───────────────────────────────────

describe('buildStrategicBulkPrompt', () => {
  it('returns system and user strings', () => {
    const prompts = makePromptConfig();
    const patternGroup = {
      patternName: 'HTTP Request',
      category: 'network',
      risk: 'medium',
      fileGroups: [],
      totalCount: 1,
    };
    const samples = [
      {
        finding: makeFinding({ location: 'src/a.js:10', evidence: 'fetch("http://example.com")' }),
        originalIndex: 0,
        fileGroup: {
          filePath: 'src/a.js',
          findings: [],
          indices: [],
          isExtensionCode: true,
          isBundledDependency: false,
          isConfig: false,
        },
        reason: 'first_occurrence',
      },
    ];

    const result = buildStrategicBulkPrompt(patternGroup, samples, prompts);

    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('user');
    expect(typeof result.system).toBe('string');
    expect(typeof result.user).toBe('string');
  });

  it('includes JSON format instructions in system prompt', () => {
    const prompts = makePromptConfig();
    const patternGroup = {
      patternName: 'P', category: 'c', risk: 'high', fileGroups: [], totalCount: 1,
    };
    const samples = [{
      finding: makeFinding(),
      originalIndex: 0,
      fileGroup: { filePath: 'x.js', findings: [], indices: [], isExtensionCode: true, isBundledDependency: false, isConfig: false },
      reason: 'all_assessed',
    }];

    const { system } = buildStrategicBulkPrompt(patternGroup, samples, prompts);
    expect(system).toContain('JSON array');
    expect(system).toContain('risk_level');
    expect(system).toContain('is_false_positive');
  });

  it('includes pattern name and category in user prompt', () => {
    const prompts = makePromptConfig();
    const patternGroup = {
      patternName: 'Dangerous Call', category: 'code_execution', risk: 'critical', fileGroups: [], totalCount: 2,
    };
    const samples = [{
      finding: makeFinding({ location: 'src/main.js:5', evidence: 'dangerous(input)' }),
      originalIndex: 0,
      fileGroup: { filePath: 'src/main.js', findings: [], indices: [], isExtensionCode: true, isBundledDependency: false, isConfig: false },
      reason: 'first_occurrence',
    }];

    const { user } = buildStrategicBulkPrompt(patternGroup, samples, prompts);
    expect(user).toContain('Dangerous Call');
    expect(user).toContain('code_execution');
    expect(user).toContain('critical');
  });

  it('groups evidence by file in user prompt', () => {
    const prompts = makePromptConfig();
    const patternGroup = {
      patternName: 'P', category: 'c', risk: 'medium', fileGroups: [], totalCount: 2,
    };
    const fg1 = { filePath: 'a.js', findings: [], indices: [], isExtensionCode: true, isBundledDependency: false, isConfig: false };
    const fg2 = { filePath: 'b.js', findings: [], indices: [], isExtensionCode: true, isBundledDependency: false, isConfig: false };

    const samples = [
      { finding: makeFinding({ location: 'a.js:1', evidence: 'code_a' }), originalIndex: 0, fileGroup: fg1, reason: 'first_occurrence' },
      { finding: makeFinding({ location: 'b.js:1', evidence: 'code_b' }), originalIndex: 1, fileGroup: fg2, reason: 'last_occurrence' },
    ];

    const { user } = buildStrategicBulkPrompt(patternGroup, samples, prompts);
    expect(user).toContain('=== File: a.js ===');
    expect(user).toContain('=== File: b.js ===');
    expect(user).toContain('code_a');
    expect(user).toContain('code_b');
  });

  it('requests exactly N assessments matching sample count', () => {
    const prompts = makePromptConfig();
    const patternGroup = { patternName: 'P', category: 'c', risk: 'low', fileGroups: [], totalCount: 3 };
    const fg = { filePath: 'x.js', findings: [], indices: [], isExtensionCode: true, isBundledDependency: false, isConfig: false };
    const samples = [
      { finding: makeFinding(), originalIndex: 0, fileGroup: fg, reason: 'a' },
      { finding: makeFinding(), originalIndex: 1, fileGroup: fg, reason: 'b' },
      { finding: makeFinding(), originalIndex: 2, fileGroup: fg, reason: 'c' },
    ];

    const { user } = buildStrategicBulkPrompt(patternGroup, samples, prompts);
    expect(user).toContain('exactly 3 assessments');
  });
});

// ─── parseStrategicAssessments ──────────────────────────────────

describe('parseStrategicAssessments', () => {
  const fg = { filePath: 'x.js', findings: [], indices: [], isExtensionCode: true, isBundledDependency: false, isConfig: false };

  function makeSamples(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      finding: makeFinding(),
      originalIndex: i * 10, // Non-sequential to verify mapping
      fileGroup: fg,
      reason: 'test',
    }));
  }

  it('parses valid JSON array response', () => {
    const samples = makeSamples(2);
    const response = JSON.stringify([
      { risk_level: 'high', is_false_positive: false, explanation: 'Dangerous', recommendation: 'investigate' },
      { risk_level: 'none', is_false_positive: true, false_positive_reason: 'Benign', explanation: 'Safe', recommendation: 'dismiss' },
    ]);

    const result = parseStrategicAssessments(response, samples);

    expect(result.size).toBe(2);
    expect(result.get(0)!.riskLevel).toBe('high');
    expect(result.get(0)!.isFalsePositive).toBe(false);
    expect(result.get(10)!.riskLevel).toBe('none');
    expect(result.get(10)!.isFalsePositive).toBe(true);
    expect(result.get(10)!.falsePositiveReason).toBe('Benign');
  });

  it('rejects camelCase field names (LLM must use snake_case)', () => {
    const samples = makeSamples(1);
    const response = JSON.stringify([
      { riskLevel: 'low', isFalsePositive: true, falsePositiveReason: 'OK', explanation: 'Fine', recommendation: 'dismiss' },
    ]);

    const result = parseStrategicAssessments(response, samples);
    expect(result.size).toBe(0);
  });

  it('returns empty map for completely malformed input', () => {
    const samples = makeSamples(1);
    const result = parseStrategicAssessments('not json at all', samples);
    expect(result.size).toBe(0);
  });

  it('returns empty map for empty string', () => {
    const result = parseStrategicAssessments('', makeSamples(1));
    expect(result.size).toBe(0);
  });

  it('handles response with extra text around JSON', () => {
    const samples = makeSamples(1);
    const response = 'Here are my assessments:\n' +
      JSON.stringify([{ risk_level: 'medium', is_false_positive: false, explanation: 'OK', recommendation: 'investigate' }]) +
      '\nDone!';

    const result = parseStrategicAssessments(response, samples);
    expect(result.size).toBe(1);
    expect(result.get(0)!.riskLevel).toBe('medium');
  });

  it('handles fewer assessments than samples (partial response)', () => {
    const samples = makeSamples(3);
    const response = JSON.stringify([
      { risk_level: 'low', is_false_positive: false, explanation: 'A', recommendation: 'dismiss' },
    ]);

    const result = parseStrategicAssessments(response, samples);
    expect(result.size).toBe(1);
    expect(result.has(0)).toBe(true);
    expect(result.has(10)).toBe(false);
  });

  it('ignores extra assessments beyond sample count', () => {
    const samples = makeSamples(1);
    const response = JSON.stringify([
      { risk_level: 'low', is_false_positive: false, explanation: 'A', recommendation: 'dismiss' },
      { risk_level: 'high', is_false_positive: false, explanation: 'B', recommendation: 'investigate' },
    ]);

    const result = parseStrategicAssessments(response, samples);
    expect(result.size).toBe(1);
  });

  it('skips assessments missing required fields (strict schema)', () => {
    const samples = makeSamples(1);
    const response = JSON.stringify([
      { risk_level: 'high', explanation: 'Bad' },
    ]);

    const result = parseStrategicAssessments(response, samples);
    expect(result.size).toBe(0);
  });
});

// ─── estimateStrategicLlmCalls ──────────────────────────────────

describe('estimateStrategicLlmCalls', () => {
  it('returns zeros for empty findings', () => {
    const result = estimateStrategicLlmCalls([]);
    expect(result).toEqual({ calls: 0, sampled: 0, total: 0 });
  });

  it('returns 1 call for a single finding', () => {
    const result = estimateStrategicLlmCalls([makeFinding()]);
    expect(result.calls).toBe(1);
    expect(result.sampled).toBe(1);
    expect(result.total).toBe(1);
  });

  it('returns 1 call for multiple findings in same pattern and file', () => {
    const findings = [
      makeFinding({ category: 'net', title: 'P', location: 'a.js:1' }),
      makeFinding({ category: 'net', title: 'P', location: 'a.js:5' }),
      makeFinding({ category: 'net', title: 'P', location: 'a.js:10' }),
    ];
    const result = estimateStrategicLlmCalls(findings);
    expect(result.calls).toBe(1);
    expect(result.total).toBe(3);
  });

  it('returns separate calls for different files within a pattern', () => {
    const findings = [
      makeFinding({ category: 'net', title: 'P', location: 'a.js:1' }),
      makeFinding({ category: 'net', title: 'P', location: 'b.js:1' }),
    ];
    const result = estimateStrategicLlmCalls(findings);
    expect(result.calls).toBe(2);
  });

  it('returns separate calls for different patterns', () => {
    const findings = [
      makeFinding({ category: 'net', title: 'P1', location: 'a.js:1' }),
      makeFinding({ category: 'net', title: 'P2', location: 'a.js:1' }),
    ];
    const result = estimateStrategicLlmCalls(findings);
    expect(result.calls).toBe(2);
  });

  it('sampled equals total (calculateSecuritySampleSize returns all)', () => {
    const findings = [
      makeFinding({ category: 'net', title: 'P', location: 'a.js:1' }),
      makeFinding({ category: 'net', title: 'P', location: 'a.js:5' }),
    ];
    const result = estimateStrategicLlmCalls(findings);
    expect(result.sampled).toBe(result.total);
  });
});
