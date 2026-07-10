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
  // Sanitize at the boundary: a NaN/negative limit would silently disable the
  // guard it controls. e.g. a NaN zeroHitSampleLimit makes `added >= limit`
  // always false, so the zero-hit sampler processes every file and can blow the
  // LLM context budget. Belt-and-suspenders with the Zod schema; also guards
  // direct callers. Per-field minimums mirror AnalysisLimitsSchema.
  const posInt = (val: number | undefined, dflt: number, minVal: number): number =>
    typeof val === 'number' && Number.isFinite(val) && val >= minVal ? Math.floor(val) : dflt;

  active = {
    maxFindingsForSummary: posInt(limits?.maxFindingsForSummary, DEFAULT_ANALYSIS_LIMITS.maxFindingsForSummary, 1),
    maxEvidenceChars: posInt(limits?.maxEvidenceChars, DEFAULT_ANALYSIS_LIMITS.maxEvidenceChars, 100),
    execSummaryChunkChars: posInt(limits?.execSummaryChunkChars, DEFAULT_ANALYSIS_LIMITS.execSummaryChunkChars, 1000),
    zeroHitSampleLimit: posInt(limits?.zeroHitSampleLimit, DEFAULT_ANALYSIS_LIMITS.zeroHitSampleLimit, 0),
    zeroHitBytesBudget: posInt(limits?.zeroHitBytesBudget, DEFAULT_ANALYSIS_LIMITS.zeroHitBytesBudget, 0),
  };
}

/** Read the active analysis limits. */
export function getAnalysisLimits(): AnalysisLimits {
  return active;
}
