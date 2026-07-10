/**
 * Risk scoring for analysis results
 */

import type { AnalysisResult, ScoringConfig } from '../types/index.js';

// Behavior-preserving defaults — these mirror the previously hardcoded values.
export const DEFAULT_SCORING: ScoringConfig = {
  riskWeights: { critical: 10, high: 5, medium: 2, low: 1 },
  injectionBoost: 5,
  binaryBoost: 5,
  verdictBoost: { malicious: 25, suspicious: 5 },
  thresholds: { verySuspicious: 50, suspicious: 30, moderate: 15 },
};

// Active scoring config, synced from AppConfig at load/save time (see config.ts).
// Defaults keep scoring identical until an operator changes it.
let activeScoring: ScoringConfig = DEFAULT_SCORING;

/** Set the scoring weights used by all scoring functions (called from config load/save). */
export function setScoringConfig(config: ScoringConfig): void {
  // Sanitize every value at this boundary: a NaN/negative/invalid input would make
  // calculateSuspicionScore produce NaN and break all downstream risk labeling.
  // Belt-and-suspenders with the Zod schema — this also guards direct/programmatic callers.
  const posInt = (val: number | undefined, dflt: number, minVal = 0): number =>
    typeof val === 'number' && Number.isFinite(val) && val >= minVal ? Math.floor(val) : dflt;

  activeScoring = {
    riskWeights: {
      critical: posInt(config?.riskWeights?.critical, DEFAULT_SCORING.riskWeights.critical),
      high: posInt(config?.riskWeights?.high, DEFAULT_SCORING.riskWeights.high),
      medium: posInt(config?.riskWeights?.medium, DEFAULT_SCORING.riskWeights.medium),
      low: posInt(config?.riskWeights?.low, DEFAULT_SCORING.riskWeights.low),
    },
    injectionBoost: posInt(config?.injectionBoost, DEFAULT_SCORING.injectionBoost),
    binaryBoost: posInt(config?.binaryBoost, DEFAULT_SCORING.binaryBoost),
    verdictBoost: {
      malicious: posInt(config?.verdictBoost?.malicious, DEFAULT_SCORING.verdictBoost.malicious),
      suspicious: posInt(config?.verdictBoost?.suspicious, DEFAULT_SCORING.verdictBoost.suspicious),
    },
    thresholds: {
      verySuspicious: posInt(config?.thresholds?.verySuspicious, DEFAULT_SCORING.thresholds.verySuspicious, 1),
      suspicious: posInt(config?.thresholds?.suspicious, DEFAULT_SCORING.thresholds.suspicious, 1),
      moderate: posInt(config?.thresholds?.moderate, DEFAULT_SCORING.thresholds.moderate, 1),
    },
  };
}

/** Label/color rows derived from the configured thresholds (text/colors are fixed). */
function thresholdRows(): Array<[number, string, string]> {
  const t = activeScoring.thresholds;
  return [
    [t.verySuspicious, 'Very Suspicious', 'red'],
    [t.suspicious, 'Suspicious', 'orange'],
    [t.moderate, 'Moderate', 'yellow'],
    [0, 'Low Risk', 'green'],
  ];
}

export interface ScoreBreakdown {
  findingsScore: number;
  structuralScore: number;
  details: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    binaryCount?: number;
    fileTypeMismatches?: number;
    notableDependencies?: string[];
    noRepository?: boolean;
    agentConfigFiles?: number;
  };
}

/**
 * Calculate suspicion score
 */
export function calculateSuspicionScore(
  result: AnalysisResult,
  options: { adjustForLlm?: boolean } = {}
): [number, ScoreBreakdown] {
  const details: ScoreBreakdown['details'] = {};
  
  // Findings score
  let findingsScore = 0;
  const riskCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  
  for (const finding of result.findings) {
    // Skip false positives if adjusting for LLM — EXCEPT when injection was
    // detected. A prompt-injection payload in the evidence can coerce the model
    // into marking findings false-positive to zero the score; injection-flagged
    // findings stay scored (and keep the injection boost below) so the attack
    // can't drive a finding-heavy extension to CLEAN / Low Risk.
    if (options.adjustForLlm && finding.isFalsePositive && !finding.injectionDetected) continue;

    const risk = (finding.riskLevel || '').toLowerCase();
    let weight = (activeScoring.riskWeights as Record<string, number>)[risk] || 0;

    // Boost findings the LLM flagged for investigation
    if (options.adjustForLlm && finding.recommendation === 'investigate') {
      weight = Math.ceil(weight * 1.5);
    }
    // Injection detection is a strong signal
    if (options.adjustForLlm && finding.injectionDetected) {
      weight += activeScoring.injectionBoost;
    }

    findingsScore += weight;

    if (risk in riskCounts) {
      riskCounts[risk]++;
    }
  }
  
  Object.assign(details, riskCounts);
  
  // Structural score
  let structuralScore = 0;
  
  // Binary files
  const binaryCount = result.binaryFiles.length;
  if (binaryCount) structuralScore += activeScoring.binaryBoost;
  details.binaryCount = binaryCount;
  
  // File type mismatches
  const mismatchCount = result.fileTypes.filter(f => f.mismatch).length;
  structuralScore += mismatchCount * 8;
  details.fileTypeMismatches = mismatchCount;
  
  // Notable dependencies
  const notable = Object.keys(result.notableDependencies);
  structuralScore += notable.length * 3;
  details.notableDependencies = notable;
  
  // No repository
  if (!result.repository) {
    structuralScore += 3;
    details.noRepository = true;
  }
  
  // Agent config files
  const agentCount = result.agentConfigFiles.length;
  if (agentCount) structuralScore += 4;
  details.agentConfigFiles = agentCount;
  
  // Verdict boost — MALICIOUS guarantees "Very Suspicious" threshold
  if (options.adjustForLlm && result.verdict === 'MALICIOUS') {
    findingsScore += activeScoring.verdictBoost.malicious;
  } else if (options.adjustForLlm && result.verdict === 'SUSPICIOUS') {
    findingsScore += activeScoring.verdictBoost.suspicious;
  }

  const total = findingsScore + structuralScore;
  
  return [
    total,
    {
      findingsScore,
      structuralScore,
      details,
    },
  ];
}

/**
 * Get risk label from score
 */
export function getRiskLabel(score: number): string {
  for (const [threshold, label] of thresholdRows()) {
    if (score >= threshold) return label;
  }
  return 'Low Risk';
}

/**
 * Get risk color from score
 */
export function getRiskColor(score: number): string {
  for (const [threshold, , color] of thresholdRows()) {
    if (score >= threshold) return color;
  }
  return 'green';
}
