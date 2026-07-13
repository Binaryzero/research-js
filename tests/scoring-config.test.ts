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

  it('enforces descending threshold order for out-of-order programmatic input', () => {
    // verySuspicious below suspicious would break the high→low label walk; the setter
    // clamps upward: moderate=20, suspicious=max(30,20)=30, verySuspicious=max(10,30)=30.
    setScoringConfig({ ...DEFAULT_SCORING, thresholds: { verySuspicious: 10, suspicious: 30, moderate: 20 } });
    expect(getRiskLabel(30)).toBe('Very Suspicious'); // top band reached at 30, not the bogus 10
    expect(getRiskLabel(25)).toBe('Moderate');        // between moderate(20) and suspicious(30)
    expect(getRiskLabel(19)).toBe('Low Risk');
  });

  it('sanitizes NaN/negative scoring values to defaults (no NaN scores)', () => {
    setScoringConfig({
      ...DEFAULT_SCORING,
      riskWeights: { ...DEFAULT_SCORING.riskWeights, critical: NaN as unknown as number },
    });
    const result = resultWith({ findings: [{ riskLevel: 'critical', isFalsePositive: false }] as never });
    const [score] = calculateSuspicionScore(result);
    expect(score).toBe(DEFAULT_SCORING.riskWeights.critical); // NaN weight → default 10, never NaN
  });
});

describe('likely_benign discount (LLM-adjusted scoring)', () => {
  afterEach(() => setScoringConfig(DEFAULT_SCORING));

  function findings(recommendation?: 'investigate' | 'likely_benign' | 'dismiss') {
    return [
      { riskLevel: 'medium', isFalsePositive: false, recommendation },
      { riskLevel: 'medium', isFalsePositive: false, recommendation },
    ] as never;
  }

  it('halves likely_benign finding weights when adjusting for LLM', () => {
    const neutral = resultWith({ findings: findings() });
    const benign = resultWith({ findings: findings('likely_benign') });
    const [neutralScore] = calculateSuspicionScore(neutral, { adjustForLlm: true });
    const [benignScore] = calculateSuspicionScore(benign, { adjustForLlm: true });

    expect(neutralScore).toBe(4);  // 2 medium x 2
    expect(benignScore).toBe(2);   // discounted by default 0.5 factor
  });

  it('does not discount in raw (non-LLM) scoring', () => {
    const benign = resultWith({ findings: findings('likely_benign') });
    const [raw] = calculateSuspicionScore(benign);
    expect(raw).toBe(4);
  });

  it('respects a configured factor and rounds the total', () => {
    setScoringConfig({ ...DEFAULT_SCORING, likelyBenignFactor: 0.25 });
    const benign = resultWith({
      findings: [{ riskLevel: 'medium', isFalsePositive: false, recommendation: 'likely_benign' }] as never,
    });
    const [score] = calculateSuspicionScore(benign, { adjustForLlm: true });
    expect(score).toBe(1); // round(2 * 0.25) = 1 (rounded from 0.5)
  });

  it('rejects out-of-range factors at the setter boundary', () => {
    setScoringConfig({ ...DEFAULT_SCORING, likelyBenignFactor: 7 as never });
    const benign = resultWith({
      findings: [{ riskLevel: 'medium', isFalsePositive: false, recommendation: 'likely_benign' }] as never,
    });
    const [score] = calculateSuspicionScore(benign, { adjustForLlm: true });
    expect(score).toBe(1); // falls back to default 0.5: round(2 * 0.5)
  });
});
