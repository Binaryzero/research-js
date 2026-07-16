import { describe, it, expect, beforeEach } from 'vitest';
import { toRenderModel, truncateEvidence } from '../src/analyzer/render-model.js';
import { getAnalysisLimits, setAnalysisLimits, DEFAULT_ANALYSIS_LIMITS } from '../src/analyzer/analysis-limits.js';
import { makeFinding, makeAnalysisResult } from './fixtures.js';
import type { EndpointFilteringConfig } from '../src/analyzer/patterns.js';

const emptyFilterConfig: EndpointFilteringConfig = {
  excluded_domains: [],
  excluded_url_patterns: [],
  endpoint_classification: [],
};

// Evidence is bounded by the active analysisLimits.maxEvidenceChars.
const EVIDENCE_LIMIT = DEFAULT_ANALYSIS_LIMITS.maxEvidenceChars;

describe('toRenderModel', () => {
  // Isolate from any other suite that mutated the module-level limits.
  beforeEach(() => setAnalysisLimits(DEFAULT_ANALYSIS_LIMITS));
  it('produces a payload with score and generatedAt', () => {
    const result = makeAnalysisResult();
    const payload = toRenderModel(result, { score: 42, filterConfig: emptyFilterConfig });

    expect(payload.score).toBe(42);
    expect(payload.result.extensionId).toBe('publisher.test-extension');
    expect(typeof payload.generatedAt).toBe('string');
  });

  it('omits fields the renderer never displays (payload slimming)', () => {
    const result = makeAnalysisResult({
      jsFiles: ['a.js', 'b.js'],
      vsixManifest: { huge: 'blob' },
      patternsSearched: { network: ['fetch'] },
      fileTypes: [{ path: 'x', extension: '', detectedType: '', description: '', size: 1, category: '', confidence: '' }],
    });
    const payload = toRenderModel(result, { score: null, filterConfig: emptyFilterConfig });
    const keys = Object.keys(payload.result);

    for (const dropped of ['jsFiles', 'vsixManifest', 'patternsSearched', 'fileTypes', 'permissions', 'dependencies', 'telemetryConfig']) {
      expect(keys).not.toContain(dropped);
    }
  });

  it('applies endpoint filtering and reports the excluded count', () => {
    const result = makeAnalysisResult({
      endpoints: [
        { url: 'https://w3.org/TR/x', file: 'a.js', line: 1, context: '', method: 'GET' },
        { url: 'https://api.evil.com/x', file: 'b.js', line: 2, context: '', method: 'POST', operational: true },
      ],
    });
    const config: EndpointFilteringConfig = { ...emptyFilterConfig, excluded_domains: ['w3.org'] };
    const payload = toRenderModel(result, { score: null, filterConfig: config });

    expect(payload.result.endpoints.map(e => e.url)).toEqual(['https://api.evil.com/x']);
    expect(payload.result.endpointExcludedCount).toBe(1);
  });

  it('slims findings to render fields and bounds evidence to the configured limit', () => {
    const bigEvidence = 'x'.repeat(EVIDENCE_LIMIT * 3);
    const result = makeAnalysisResult({
      findings: [makeFinding({ evidence: bigEvidence, context: 'never rendered', lineStart: 5, lineEnd: 9 })],
    });
    const payload = toRenderModel(result, { score: null, filterConfig: emptyFilterConfig });
    const f = payload.result.findings[0];

    expect(f.evidence.length).toBeLessThanOrEqual(EVIDENCE_LIMIT);
    expect(f.evidenceTruncated).toBe(true);
    expect(f.evidenceFullLength).toBe(bigEvidence.length);
    expect(f).not.toHaveProperty('context');
    expect(f).not.toHaveProperty('lineStart');
    expect(f).not.toHaveProperty('neighboringImports');
  });

  it('ships the full captured evidence when the operator raises maxEvidenceChars', () => {
    // The screen showed only 4K before, regardless of config — the double cap.
    setAnalysisLimits({ ...DEFAULT_ANALYSIS_LIMITS, maxEvidenceChars: 400_000 });
    const bigEvidence = 'x'.repeat(120_000); // > old 4K cap, < new 400K limit
    const result = makeAnalysisResult({ findings: [makeFinding({ evidence: bigEvidence })] });
    const f = toRenderModel(result, { score: null, filterConfig: emptyFilterConfig }).result.findings[0];

    expect(f.evidence.length).toBe(120_000);
    expect(f.evidenceTruncated).toBe(false);
  });

  it('strips control/binary bytes from displayed evidence (readable minified source)', () => {
    const dirty = 'const a=1;\x00\x01 const b=2;�';
    const result = makeAnalysisResult({ findings: [makeFinding({ evidence: dirty })] });
    const f = toRenderModel(result, { score: null, filterConfig: emptyFilterConfig }).result.findings[0];

    expect(f.evidence).toBe('const a=1; const b=2;');
  });

  it('marks short evidence as untruncated', () => {
    const result = makeAnalysisResult({ findings: [makeFinding({ evidence: 'short' })] });
    const payload = toRenderModel(result, { score: null, filterConfig: emptyFilterConfig });

    expect(payload.result.findings[0].evidence).toBe('short');
    expect(payload.result.findings[0].evidenceTruncated).toBe(false);
  });

  it('preserves consensus and LLM assessment fields on findings', () => {
    const result = makeAnalysisResult({
      findings: [makeFinding({
        isFalsePositive: true,
        falsePositiveReason: 'test fixture',
        recommendation: 'dismiss',
        injectionDetected: true,
        consensus: { votes: [{ riskLevel: 'high', isFalsePositive: false, recommendation: 'investigate' }], unanimous: true, splitDecision: false },
      })],
    });
    const payload = toRenderModel(result, { score: null, filterConfig: emptyFilterConfig });
    const f = payload.result.findings[0];

    expect(f.isFalsePositive).toBe(true);
    expect(f.falsePositiveReason).toBe('test fixture');
    expect(f.recommendation).toBe('dismiss');
    expect(f.injectionDetected).toBe(true);
    expect(f.consensus?.unanimous).toBe(true);
  });

  it('does not mutate the input result', () => {
    const result = makeAnalysisResult({
      findings: [makeFinding({ evidence: 'y'.repeat(EVIDENCE_LIMIT * 2) })],
    });
    const snapshot = JSON.parse(JSON.stringify(result));
    toRenderModel(result, { score: null, filterConfig: emptyFilterConfig });

    expect(result).toEqual(snapshot);
  });
});

describe('truncateEvidence', () => {
  it('returns short evidence unchanged', () => {
    const { text, truncated } = truncateEvidence('let x = 1;', undefined, 100);
    expect(text).toBe('let x = 1;');
    expect(truncated).toBe(false);
  });

  it('never returns more than the limit', () => {
    const { text, truncated } = truncateEvidence('a'.repeat(500), undefined, 100);
    expect(text.length).toBeLessThanOrEqual(100);
    expect(truncated).toBe(true);
  });

  it('keeps the matchHighlight visible in the truncated text when present', () => {
    const evidence = 'a'.repeat(400) + 'EVIL_MARKER' + 'b'.repeat(400);
    const { text } = truncateEvidence(evidence, 'EVIL_MARKER', 200);
    expect(text).toContain('EVIL_MARKER');
    expect(text.length).toBeLessThanOrEqual(200);
  });

  it('never exceeds degenerate tiny limits', () => {
    const evidence = 'a'.repeat(50) + 'MATCH' + 'b'.repeat(50);
    for (const limit of [0, 1, 2, 3]) {
      const { text, truncated } = truncateEvidence(evidence, 'MATCH', limit);
      expect(text.length).toBeLessThanOrEqual(limit);
      expect(truncated).toBe(true);
    }
  });
});
