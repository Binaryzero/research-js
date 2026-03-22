import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReportGenerator } from '../src/analyzer/report.js';
import { makeFinding, makeAnalysisResult } from './fixtures.js';

vi.mock('../src/analyzer/patterns.js', () => ({
  getEndpointFiltering: () => ({
    excluded_domains: [],
    excluded_url_patterns: [],
    endpoint_classification: [],
  }),
}));

describe('ReportGenerator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates valid markdown for a clean extension', () => {
    const result = makeAnalysisResult({ findings: [] });
    const report = new ReportGenerator(result).generate();

    expect(report).toContain('# Extension Analysis: test-ext');
    expect(report).toContain('**Version:** 1.0.0');
    expect(report).toContain('## Metadata');
  });

  it('groups findings by category with correct headers', () => {
    const findings = [
      makeFinding({ category: 'network', title: 'Net 1' }),
      makeFinding({ category: 'network', title: 'Net 2' }),
      makeFinding({ category: 'obfuscation', title: 'Obf 1' }),
    ];
    const result = makeAnalysisResult({ findings });
    const report = new ReportGenerator(result).generate();

    expect(report).toContain('## Network (2 findings)');
    expect(report).toContain('## Obfuscation (1 findings)');
  });

  it('truncates evidence exceeding 1500 characters', () => {
    const longEvidence = 'x'.repeat(2000);
    const findings = [makeFinding({ evidence: longEvidence })];
    const result = makeAnalysisResult({ findings });
    const report = new ReportGenerator(result).generate();

    expect(report).toContain('// ... truncated');
    // The full 2000-char evidence should not appear
    expect(report).not.toContain(longEvidence);
  });

  it('limits findings per category to 25', () => {
    const findings = Array.from({ length: 30 }, (_, i) =>
      makeFinding({ title: `Finding ${i + 1}`, category: 'network' }),
    );
    const result = makeAnalysisResult({ findings });
    const report = new ReportGenerator(result).generate();

    expect(report).toContain('## Network (30 findings)');
    expect(report).toContain('Finding 25');
    expect(report).not.toContain('Finding 26:');
    expect(report).toContain('5 more findings');
  });

  it('includes executive summary when present', () => {
    const result = makeAnalysisResult({
      executiveSummary: 'This extension appears safe.',
    });
    const report = new ReportGenerator(result).generate();

    expect(report).toContain('## Executive Summary');
    expect(report).toContain('This extension appears safe.');
  });

  it('shows verdict badge when present', () => {
    const result = makeAnalysisResult({ verdict: 'SUSPICIOUS' });
    const report = new ReportGenerator(result).generate();

    expect(report).toContain('**Verdict:** SUSPICIOUS');
  });

  it('hides false positives when hideFalsePositives option is set', () => {
    const findings = [
      makeFinding({ title: 'Real Issue', isFalsePositive: false }),
      makeFinding({ title: 'False Alarm', isFalsePositive: true }),
    ];
    const result = makeAnalysisResult({ findings });
    const report = new ReportGenerator(result, { hideFalsePositives: true }).generate();

    expect(report).toContain('Real Issue');
    expect(report).not.toContain('False Alarm');
  });

  it('displays consensus metadata for findings with votes', () => {
    const findings = [
      makeFinding({
        title: 'Consensus Finding',
        riskLevel: 'high',
        consensus: {
          votes: [
            { riskLevel: 'high', isFalsePositive: false, recommendation: 'investigate', modelId: 'main' },
            { riskLevel: 'medium', isFalsePositive: false, recommendation: 'investigate', modelId: 'judge1' },
          ],
          unanimous: false,
          splitDecision: true,
        },
      }),
    ];
    const result = makeAnalysisResult({ findings });
    const report = new ReportGenerator(result).generate();

    expect(report).toContain('Split decision');
    expect(report).toContain('high, medium');
  });
});
