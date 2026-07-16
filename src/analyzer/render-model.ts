/**
 * Render model for HTML reports.
 *
 * Maps a full AnalysisResult to the slim payload the client-side renderer
 * (assets/static/report-view.js) consumes — both when embedded into a
 * standalone .html report and when served by /api/reports/:name/data.
 *
 * Two jobs happen here, server-side, so the client never sees raw data:
 *   - payload slimming: only fields the renderer displays are included
 *     (a full AnalysisResult carries file lists, the VSIX manifest, pattern
 *     scan state, etc. — megabytes the report page never renders)
 *   - evidence bounding: evidence is attacker-controlled source code from the
 *     scanned extension, already bounded once at scan time by
 *     analysisLimits.maxEvidenceChars. The renderer shows that full captured
 *     evidence (the report page puts it in a height-capped, scrollable block),
 *     rather than re-truncating to a smaller display cap that starved the
 *     screen of context. Control/binary bytes are stripped so minified source
 *     stays readable on screen.
 */

import type { AnalysisResult, BinaryInfo, FileStats, Finding } from '../types/index.js';
import type { EndpointFilteringConfig } from './patterns.js';
import { filterEndpoints } from './endpoint-filter.js';
import { truncateEvidence } from './evidence.js';
import { getAnalysisLimits } from './analysis-limits.js';
import { sanitizeForLlm } from '../providers/sanitize.js';

export { truncateEvidence };

export interface RenderEndpoint {
  url: string;
  method: string;
  operational: boolean;
  file: string;
  line: number;
}

export interface RenderFinding {
  category: string;
  title: string;
  location: string;
  observation: string;
  evidence: string;
  evidenceTruncated: boolean;
  evidenceFullLength: number;
  isFalsePositive: boolean;
  falsePositiveReason: string;
  riskLevel: string;
  patternName?: string;
  probableOrigin?: Finding['probableOrigin'];
  isMinified?: boolean;
  injectionDetected?: boolean;
  recommendation?: Finding['recommendation'];
  matchHighlight?: string;
  consensus?: Finding['consensus'];
}

export interface ReportRenderModel {
  extensionName: string;
  extensionId: string;
  version: string;
  analysisDate: string;
  publisher: string;
  description: string;
  repository: string;
  categories: string[];
  activationEvents: string[];
  bundledDependencies: string[];
  fileStats: Record<string, FileStats>;
  totalSize: number;
  binaryHashes: BinaryInfo[];
  endpoints: RenderEndpoint[];
  endpointExcludedCount: number;
  executiveSummary: string | null;
  verdict: AnalysisResult['verdict'];
  findings: RenderFinding[];
}

export interface ReportPayload {
  result: ReportRenderModel;
  score: number | null;
  generatedAt: string;
}

export interface RenderModelOptions {
  score: number | null;
  filterConfig: EndpointFilteringConfig;
}

function toRenderFinding(f: Finding): RenderFinding {
  // Strip control/binary bytes (minified bundles read as UTF-8 leave them) so
  // the evidence renders as readable code, then show the full captured amount —
  // bounded once, at scan time, by analysisLimits.maxEvidenceChars.
  const evidence = sanitizeForLlm(String(f.evidence || ''));
  const { text, truncated } = truncateEvidence(evidence, f.matchHighlight, getAnalysisLimits().maxEvidenceChars);
  return {
    category: f.category,
    title: f.title,
    location: f.location,
    observation: f.observation,
    evidence: text,
    evidenceTruncated: truncated,
    evidenceFullLength: evidence.length,
    isFalsePositive: f.isFalsePositive,
    falsePositiveReason: f.falsePositiveReason,
    riskLevel: f.riskLevel,
    ...(f.patternName !== undefined && { patternName: f.patternName }),
    ...(f.probableOrigin !== undefined && { probableOrigin: f.probableOrigin }),
    ...(f.isMinified !== undefined && { isMinified: f.isMinified }),
    ...(f.injectionDetected !== undefined && { injectionDetected: f.injectionDetected }),
    ...(f.recommendation !== undefined && { recommendation: f.recommendation }),
    ...(f.matchHighlight !== undefined && { matchHighlight: f.matchHighlight }),
    ...(f.consensus !== undefined && { consensus: f.consensus }),
  };
}

export function toRenderModel(result: AnalysisResult, options: RenderModelOptions): ReportPayload {
  const { filtered, excludedCount } = filterEndpoints(
    Array.isArray(result.endpoints) ? result.endpoints : [],
    { repository: result.repository, homepage: result.homepage },
    options.filterConfig,
  );

  const model: ReportRenderModel = {
    extensionName: result.extensionName,
    extensionId: result.extensionId,
    version: result.version,
    analysisDate: result.analysisDate,
    publisher: result.publisher,
    description: result.description,
    repository: result.repository,
    categories: Array.isArray(result.categories) ? result.categories : [],
    activationEvents: Array.isArray(result.activationEvents) ? result.activationEvents : [],
    bundledDependencies: Array.isArray(result.bundledDependencies) ? result.bundledDependencies : [],
    fileStats: result.fileStats || {},
    totalSize: result.totalSize || 0,
    binaryHashes: Array.isArray(result.binaryHashes) ? result.binaryHashes : [],
    endpoints: filtered.map(e => ({
      url: e.url,
      method: e.method || '-',
      operational: !!e.operational,
      file: e.file,
      line: e.line,
    })),
    endpointExcludedCount: excludedCount,
    executiveSummary: result.executiveSummary,
    verdict: result.verdict,
    findings: (Array.isArray(result.findings) ? result.findings : []).map(toRenderFinding),
  };

  return {
    result: model,
    score: options.score,
    generatedAt: new Date().toISOString(),
  };
}
