import { describe, it, expect, afterEach } from 'vitest';
import {
  getAnalysisLimits,
  setAnalysisLimits,
  DEFAULT_ANALYSIS_LIMITS,
} from '../src/analyzer/analysis-limits.js';
import { AnalysisLimitsSchema } from '../src/schemas/config.js';

describe('analysis limits', () => {
  // setAnalysisLimits mutates module-global state — restore defaults after each test.
  afterEach(() => setAnalysisLimits(DEFAULT_ANALYSIS_LIMITS));

  it('starts at the behavior-preserving defaults', () => {
    expect(getAnalysisLimits()).toEqual({
      maxFindingsForSummary: 100,
      maxEvidenceChars: 4000,
      execSummaryChunkChars: 50000,
      zeroHitSampleLimit: 6,
      zeroHitBytesBudget: 60000,
    });
  });

  it('setAnalysisLimits updates what consumers read', () => {
    setAnalysisLimits({ ...DEFAULT_ANALYSIS_LIMITS, maxFindingsForSummary: 500, maxEvidenceChars: 12000 });
    expect(getAnalysisLimits().maxFindingsForSummary).toBe(500);
    expect(getAnalysisLimits().maxEvidenceChars).toBe(12000);
  });

  it('AnalysisLimitsSchema fills every field from {} to the defaults', () => {
    expect(AnalysisLimitsSchema.parse({})).toEqual(DEFAULT_ANALYSIS_LIMITS);
  });

  it('AnalysisLimitsSchema keeps other defaults on a partial input', () => {
    const parsed = AnalysisLimitsSchema.parse({ maxEvidenceChars: 9999 });
    expect(parsed.maxEvidenceChars).toBe(9999);
    expect(parsed.maxFindingsForSummary).toBe(100);
  });
});
