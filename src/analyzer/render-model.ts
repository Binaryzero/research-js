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
 *     scanned extension; its rendered size is capped independently of the
 *     scan-time capture limit (analysisLimits.maxEvidenceChars is
 *     operator-configurable up to 1MB)
 */

import type { AnalysisResult, BinaryInfo, FileStats, Finding } from '../types/index.js';
import type { EndpointFilteringConfig } from './patterns.js';
import { filterEndpoints } from './endpoint-filter.js';
import { truncateEvidence } from './evidence.js';

export { truncateEvidence };

/** Max evidence characters embedded per finding in the HTML render model. */
export const EVIDENCE_RENDER_LIMIT = 4000;

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
  const evidence = String(f.evidence || '');
  const { text, truncated } = truncateEvidence(evidence, f.matchHighlight, EVIDENCE_RENDER_LIMIT);
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
