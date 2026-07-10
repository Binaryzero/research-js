/**
 * Analysis-pipeline size limits, shared across the analyzer modules.
 *
 * Several limits live in module-level functions (chunkSourceFiles,
 * readFindingSourceFiles) and in StaticAnalyzer, so they can't be threaded
 * through a single class. A module singleton — synced from AppConfig at
 * load/save time (see config.ts) — keeps them configurable without plumbing
 * the config into every call site.
 */
import type { AnalysisLimits } from '../types/index.js';

// Behavior-preserving defaults (mirror the previously hardcoded values).
export const DEFAULT_ANALYSIS_LIMITS: AnalysisLimits = {
  maxFindingsForSummary: 100,
  maxEvidenceChars: 4000,
  execSummaryChunkChars: 50_000,
  zeroHitSampleLimit: 6,
  zeroHitBytesBudget: 60_000,
};

let active: AnalysisLimits = DEFAULT_ANALYSIS_LIMITS;

/** Set the active analysis limits (called from config load/save). */
export function setAnalysisLimits(limits: AnalysisLimits): void {
  active = limits;
}

/** Read the active analysis limits. */
export function getAnalysisLimits(): AnalysisLimits {
  return active;
}
