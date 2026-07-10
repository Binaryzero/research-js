import { describe, it, expect, afterEach } from 'vitest';
import {
  getRiskLabel,
  getRiskColor,
  calculateSuspicionScore,
  setScoringConfig,
  DEFAULT_SCORING,
} from '../src/analyzer/scoring.js';
import { ScoringConfigSchema } from '../src/schemas/config.js';
import type { AnalysisResult } from '../src/types/index.js';

function resultWith(overrides: Partial<AnalysisResult>): AnalysisResult {
  return {
    findings: [], binaryFiles: [], fileTypes: [], notableDependencies: {},
    repository: 'https://example.com/repo', agentConfigFiles: [],
    ...overrides,
  } as unknown as AnalysisResult;
}

describe('scoring config', () => {
  // setScoringConfig mutates module-global state — restore defaults after each test.
  afterEach(() => setScoringConfig(DEFAULT_SCORING));

  it('default thresholds preserve the existing labels', () => {
    expect(getRiskLabel(50)).toBe('Very Suspicious');
    expect(getRiskLabel(30)).toBe('Suspicious');
    expect(getRiskLabel(15)).toBe('Moderate');
    expect(getRiskLabel(0)).toBe('Low Risk');
  });

  it('custom thresholds shift the label boundaries', () => {
    setScoringConfig({ ...DEFAULT_SCORING, thresholds: { verySuspicious: 80, suspicious: 40, moderate: 20 } });
    expect(getRiskLabel(50)).toBe('Suspicious');       // was Very Suspicious at default 50
    expect(getRiskLabel(85)).toBe('Very Suspicious');
    expect(getRiskColor(85)).toBe('red');
  });

  it('custom risk weights change the computed score', () => {
    const result = resultWith({ findings: [{ riskLevel: 'critical', isFalsePositive: false }] as never });
    const [base] = calculateSuspicionScore(result);
    setScoringConfig({ ...DEFAULT_SCORING, riskWeights: { ...DEFAULT_SCORING.riskWeights, critical: 100 } });
    const [boosted] = calculateSuspicionScore(result);
    expect(base).toBe(10);
    expect(boosted).toBe(100);
  });

  it('ScoringConfigSchema fills every field from {} to the defaults', () => {
    expect(ScoringConfigSchema.parse({})).toEqual(DEFAULT_SCORING);
  });
});
