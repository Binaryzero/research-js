/**
 * Risk scoring for analysis results
 */

import type { AnalysisResult } from '../types/index.js';

const RISK_WEIGHTS: Record<string, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 1,
};

const THRESHOLDS: Array<[number, string, string]> = [
  [50, 'Very Suspicious', 'red'],
  [30, 'Suspicious', 'orange'],
  [15, 'Moderate', 'yellow'],
  [0, 'Low Risk', 'green'],
];

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
    // Skip false positives if adjusting for LLM
    if (options.adjustForLlm && finding.isFalsePositive) continue;

    const risk = (finding.riskLevel || '').toLowerCase();
    let weight = RISK_WEIGHTS[risk] || 0;

    // Boost findings the LLM flagged for investigation
    if (options.adjustForLlm && finding.recommendation === 'investigate') {
      weight = Math.ceil(weight * 1.5);
    }
    // Injection detection is a strong signal
    if (options.adjustForLlm && finding.injectionDetected) {
      weight += 5;
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
  if (binaryCount) structuralScore += 5;
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
    findingsScore += 25;
  } else if (options.adjustForLlm && result.verdict === 'SUSPICIOUS') {
    findingsScore += 5;
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
  for (const [threshold, label] of THRESHOLDS) {
    if (score >= threshold) return label;
  }
  return 'Low Risk';
}

/**
 * Get risk color from score
 */
export function getRiskColor(score: number): string {
  for (const [threshold, , color] of THRESHOLDS) {
    if (score >= threshold) return color;
  }
  return 'green';
}
