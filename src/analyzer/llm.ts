/**
 * Concurrent LLM client for Ollama/OpenAI-compatible APIs
 * Key performance feature: parallel batch processing with concurrency limiting
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import type { Finding, LlmAssessment, LlmConfig, EndpointInfo, ConsensusConfig, AnalysisResult } from '../types/index.js';
import type { PromptConfig } from '../config.js';
import { getEndpointFiltering } from './patterns.js';
import type { LlmProvider } from '../providers/llm-provider.js';
import { OllamaProvider } from '../providers/ollama-provider.js';

/**
 * Concurrency limiter - ensures only N concurrent operations at a time
 */
class ConcurrencyLimiter {
  private active = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private maxConcurrent: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.next();
        }
      };

      if (this.active < this.maxConcurrent) {
        this.active++;
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  private next() {
    this.active--;
    if (this.queue.length > 0) {
      this.active++;
      const nextFn = this.queue.shift();
      if (nextFn) nextFn();
    }
  }
}

// Import types for strategic mode
import type { PatternGroup, FileGroup } from './llm-batch.js';

/**
 * Parse the VERDICT line from an executive summary.
 * Expected format: first line is "VERDICT: CLEAN", "VERDICT: SUSPICIOUS", or "VERDICT: MALICIOUS"
 * Returns the verdict and the remaining prose (without the VERDICT line).
 * Defaults to SUSPICIOUS if parsing fails.
 */
export function parseVerdictFromSummary(summary: string): {
  verdict: 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
  prose: string;
} {
  if (!summary || !summary.trim()) {
    return { verdict: 'SUSPICIOUS', prose: summary || '' };
  }

  const lines = summary.split('\n');
  const firstLine = lines[0].trim();
  const match = firstLine.match(/^VERDICT:\s*(CLEAN|SUSPICIOUS|MALICIOUS)\s*$/i);

  if (match) {
    const verdict = match[1].toUpperCase() as 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS';
    const prose = lines.slice(1).join('\n').trim();
    return { verdict, prose };
  }

  return { verdict: 'SUSPICIOUS', prose: summary };
}

// Used by mergeConsensusAssessments for tie-breaking toward higher risk
export const RISK_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
export const RECOMMEND_ORDER: Record<string, number> = { investigate: 2, likely_benign: 1, dismiss: 0 };

/**
 * Parse a single LLM response into an LlmAssessment, or null on failure.
 */
function parseSingleAssessment(response: string): LlmAssessment | null {
  try {
    const jsonMatch = response.match(/\{[^{}]*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        riskLevel: (parsed.riskLevel || parsed.risk_level || 'unknown') as LlmAssessment['riskLevel'],
        isFalsePositive: (parsed.isFalsePositive ?? parsed.is_false_positive ?? false) as boolean,
        falsePositiveReason: (parsed.falsePositiveReason || parsed.false_positive_reason || '') as string,
        explanation: (parsed.explanation || '') as string,
        recommendation: (parsed.recommendation || 'investigate') as LlmAssessment['recommendation'],
        injectionDetected: (parsed.injectionDetected ?? parsed.injection_detected ?? false) as boolean,
      };
    }
  } catch {
    // Return null on parse failure
  }
  return null;
}

/**
 * Merge multiple LLM assessments for the same finding using majority vote.
 * Ties break toward higher risk. injectionDetected is true if ANY run detected it.
 * Explanation is taken from whichever run matched the winning riskLevel.
 */
function mergeConsensusAssessments(assessments: LlmAssessment[]): LlmAssessment {
  function majorityOrTiebreak<T extends string>(values: T[], order: Record<string, number>): T {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    const maxCount = Math.max(...counts.values());
    const tied = [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v);
    return tied.sort((a, b) => (order[b] ?? 0) - (order[a] ?? 0))[0];
  }

  const riskLevel = majorityOrTiebreak(assessments.map(a => a.riskLevel), RISK_ORDER);
  const isFalsePositive = assessments.filter(a => a.isFalsePositive).length > assessments.length / 2
    ? true : assessments.filter(a => !a.isFalsePositive).length > assessments.length / 2
    ? false : false; // tie breaks toward not-false-positive (safer)
  const recommendation = majorityOrTiebreak(assessments.map(a => a.recommendation), RECOMMEND_ORDER);
  const injectionDetected = assessments.some(a => a.injectionDetected);

  const riskMatch = assessments.find(a => a.riskLevel === riskLevel);
  const fpMatch = assessments.find(a => a.isFalsePositive === isFalsePositive);

  // Build consensus metadata
  const votes = assessments.map(a => ({
    riskLevel: a.riskLevel,
    isFalsePositive: a.isFalsePositive,
    recommendation: a.recommendation,
  }));
  const riskLevels = new Set(assessments.map(a => a.riskLevel));
  const unanimous = riskLevels.size === 1
    && new Set(assessments.map(a => a.isFalsePositive)).size === 1
    && new Set(assessments.map(a => a.recommendation)).size === 1;
  const splitDecision = riskLevels.size > 1;

  if (splitDecision) {
    console.log(`[Consensus] Split decision: votes=[${votes.map(v => v.riskLevel).join(', ')}] → ${riskLevel}`);
  }

  return {
    riskLevel,
    isFalsePositive,
    falsePositiveReason: fpMatch?.falsePositiveReason || '',
    explanation: riskMatch?.explanation || assessments[0].explanation,
    recommendation,
    injectionDetected,
    consensus: { votes, unanimous, splitDecision },
  };
}

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
  groupFindingsByPatternAndFile,
  calculateSecuritySampleSize,
  selectDiverseSamples,
  buildStrategicBulkPrompt,
  parseStrategicAssessments,
  estimateStrategicLlmCalls,
} from './llm-batch.js';

/**
 * Collect the full source code of every file that produced a finding.
 * Returns a single string with --- filename --- headers between each file's content,
 * or an empty string if there are no findings.
 */
// Max chars of source content per executive summary LLM call.
// If total source exceeds this, we split into multiple calls and merge.
const EXEC_SUMMARY_CHUNK_SIZE = 50_000;

/**
 * Read source files referenced by findings, returning per-file sections.
 */
function readFindingSourceFiles(findings: Finding[], extensionPath: string): Array<{ path: string; section: string }> {
  const uniquePaths = new Set<string>();
  for (const f of findings) {
    const loc = f.location || '';
    const lastColon = loc.lastIndexOf(':');
    const filePath = lastColon > 0 ? loc.slice(0, lastColon) : loc;
    if (filePath) uniquePaths.add(filePath);
  }

  const files: Array<{ path: string; section: string }> = [];
  for (const relativePath of uniquePaths) {
    try {
      const content = readFileSync(join(extensionPath, relativePath), 'utf-8');
      files.push({ path: relativePath, section: `--- ${relativePath} ---\n${content}` });
    } catch {
      // Skip unreadable files
    }
  }
  return files;
}

export function buildSourceFiles(findings: Finding[], extensionPath: string): string {
  if (findings.length === 0) return '';
  return readFindingSourceFiles(findings, extensionPath).map(f => f.section).join('\n');
}

/**
 * Split source files into chunks that fit within context limits.
 * Each chunk contains complete files (never splits mid-file) so no content is lost.
 */
export function chunkSourceFiles(findings: Finding[], extensionPath: string): string[] {
  if (findings.length === 0) return [''];

  const files = readFindingSourceFiles(findings, extensionPath);
  if (files.length === 0) return [''];

  const totalSize = files.reduce((sum, f) => sum + f.section.length, 0);
  if (totalSize <= EXEC_SUMMARY_CHUNK_SIZE) {
    return [files.map(f => f.section).join('\n')];
  }

  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentSize = 0;

  for (const file of files) {
    const fileSize = file.section.length;

    // Single file exceeding chunk size gets its own chunk
    if (fileSize > EXEC_SUMMARY_CHUNK_SIZE) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
        currentSize = 0;
      }
      chunks.push(file.section);
      continue;
    }

    if (currentSize + fileSize > EXEC_SUMMARY_CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(file.section);
    currentSize += fileSize;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
  }

  return chunks.length > 0 ? chunks : [''];
}

/**
 * Fast heuristic assessor for common false positives
 */
class FastRiskAssessor {
  private licensePatterns = [
    /MIT License/i,
    /Apache License/i,
    /BSD License/i,
    /without restriction/i,
    /no limitation/i,
    /THE SOFTWARE IS PROVIDED/i,
  ];
  
  private testPatterns = [
    /test|spec|mock|fixture/i,
    /__tests__/,
    /\.test\./,
    /\.spec\./,
  ];
  
  private commonNonEnglish = [
    /\bdans\b/i,   // French "in"
    /\bdas\b/i,    // German "the"
    /\bder\b/i,    // German "the"
    /\bdie\b/i,    // German "the"
    /\blos\b/i,    // Spanish "the"
    /\blas\b/i,    // Spanish "the"
  ];
  
  assess(finding: Finding): LlmAssessment | null {
    const evidence = finding.evidence;
    
    // License files
    if (this.licensePatterns.some(p => p.test(evidence))) {
      return {
        riskLevel: 'none',
        isFalsePositive: true,
        falsePositiveReason: 'Standard license text',
        explanation: 'This appears to be standard open source license boilerplate.',
        recommendation: 'dismiss',
      };
    }
    
    // Test files
    if (this.testPatterns.some(p => p.test(finding.location))) {
      return {
        riskLevel: 'low',
        isFalsePositive: true,
        falsePositiveReason: 'Test file content',
        explanation: 'Pattern found in test/mock file.',
        recommendation: 'likely_benign',
      };
    }
    
    // Common non-English words triggering false positives
    if (this.commonNonEnglish.some(p => p.test(evidence))) {
      return {
        riskLevel: 'none',
        isFalsePositive: true,
        falsePositiveReason: 'Likely non-English text',
        explanation: 'Matched common non-English word.',
        recommendation: 'dismiss',
      };
    }
    
    // TypeScript compilation artifacts
    if (/_\d+\.\w+\(/.test(evidence) || /require\(["\']\.\//.test(evidence)) {
      return {
        riskLevel: 'low',
        isFalsePositive: true,
        falsePositiveReason: 'TypeScript compilation artifact',
        explanation: 'Normal TypeScript compiled code.',
        recommendation: 'likely_benign',
      };
    }
    
    return null;
  }
}

/**
 * LLM Client with concurrent batch processing
 */
export class LlmClient {
  private config: LlmConfig;
  private provider: LlmProvider;
  private fastAssessor: FastRiskAssessor;
  private prompts: PromptConfig;

  constructor(config: LlmConfig, prompts?: PromptConfig, provider?: LlmProvider) {
    this.config = config;
    this.provider = provider || new OllamaProvider(
      { id: 'main', model: config.model },
      { baseUrl: config.baseUrl.replace(/\/$/, ''), apiStyle: config.apiStyle, timeout: config.timeout },
      { maxTokens: config.maxTokens, temperature: config.temperature },
    );
    this.fastAssessor = new FastRiskAssessor();
    this.prompts = prompts || this.getDefaultPrompts();
    // Concurrency limiter for Ollama requests - prevents 429 errors
    this.concurrencyLimiter = new ConcurrencyLimiter(this.concurrency);
    console.log(`[LLM] Client initialized with assessmentMode: ${config.assessmentMode}`);
  }

  get concurrency(): number {
    return this.config.concurrency || 10;
  }

  private readonly concurrencyLimiter: ConcurrencyLimiter;

  private getDefaultPrompts(): PromptConfig {
    return {
      version: '1.0',
      finding_assessment: {
        system: `You are a security analyst assessing VS Code extension findings.
Determine if a pattern match is a genuine security concern or a false positive.

Respond ONLY with a JSON object containing:
- "risk_level": one of "critical", "high", "medium", "low", "none"
- "is_false_positive": boolean
- "false_positive_reason": string (if is_false_positive is true)
- "explanation": 1-2 sentence factual explanation
- "recommendation": "investigate", "likely_benign", or "dismiss"`,
        user: `Assess this security finding:

Category: {category}
Pattern: {title}
File: {location}

Code context:
\`\`\`
{evidence}
\`\`\`

Respond with JSON only.`,
        common_false_positives: '',
        genuine_concerns: '',
      },
      executive_summary: {
        system: 'You are a security analyst writing executive summaries. Be factual, neutral, and concise.',
        user: 'Write a 2-3 paragraph executive summary for this extension analysis...',
      },
      finding_prose: {
        system: 'You are a technical writer producing security analysis reports.',
        user: 'Write a neutral finding description...',
      },
    };
  }
  
  /**
   * Check if LLM is available (delegates to provider)
   */
  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }

  /**
   * Generate completion (delegates to provider)
   */
  async generate(prompt: string, system?: string): Promise<string> {
    return this.provider.generate(prompt, system);
  }
  
  /**
   * Batch assess findings with configurable mode
   * - 'strategic': Groups by pattern AND file, uses diverse sampling (~50-200 LLM calls)
   * - 'bulk': Sends all findings in a single LLM call (1 call, requires large context model)
   */
  async batchAssessFindings(
    findings: Finding[],
    options: {
      onProgress?: (progress: number, message: string) => void;
      extensionName?: string;
      concurrencyLimit?: number;
    } = {}
  ): Promise<LlmAssessment[]> {
    // Route to appropriate mode based on config
    console.log(`[LLM] Assessment mode: ${this.config.assessmentMode}, findings: ${findings.length}`);
    if (this.config.assessmentMode === 'bulk') {
      console.log('[LLM] Using BULK mode - single call for all findings');
      return this.bulkAssessAllFindings(findings, options);
    }

    // Triage batch: when >5 findings and triage_batch prompt is configured
    if (findings.length > 5 && this.prompts.triage_batch?.system && this.prompts.triage_batch?.user) {
      console.log('[LLM] Using TRIAGE BATCH mode - tiered batching');
      return this.triageBatchAssess(findings, options);
    }

    // ≤5 findings or no triage_batch prompt: individual calls via strategic mode
    console.log('[LLM] Using STRATEGIC mode - individual assessment calls');
    return this.strategicAssessFindings(findings, options);
  }

  /**
   * Bulk assess ALL findings in a single LLM call
   * Optimized for large context models (1M+ tokens) that can process thousands of findings at once
   * Completes in ~5 minutes vs 11+ hours for strategic sampling mode
   */
  async bulkAssessAllFindings(
    findings: Finding[],
    options: {
      onProgress?: (progress: number, message: string) => void;
    } = {}
  ): Promise<LlmAssessment[]> {
    const results: LlmAssessment[] = new Array(findings.length);
    const pendingIndices: number[] = [];

    // First pass: fast heuristic assessment (same as strategic mode)
    for (let i = 0; i < findings.length; i++) {
      const fastResult = this.fastAssessor.assess(findings[i]);
      if (fastResult) {
        results[i] = fastResult;
      } else {
        pendingIndices.push(i);
      }
    }

    const fastAssessedCount = findings.length - pendingIndices.length;
    options.onProgress?.(0.05, `Fast assessed ${fastAssessedCount}/${findings.length}. ${pendingIndices.length} need LLM review (1 bulk call)`);

    if (pendingIndices.length === 0) {
      return results;
    }

    // Warn if maxTokens might be too low for bulk mode
    const estimatedTokensNeeded = pendingIndices.length * 100; // Rough estimate: 100 tokens per assessment
    if (this.config.maxTokens < estimatedTokensNeeded) {
      console.warn(`[LLM] Warning: maxTokens (${this.config.maxTokens}) may be too low for ${pendingIndices.length} findings. ` +
        `Estimated need: ~${estimatedTokensNeeded} tokens. Consider increasing LLM_MAX_TOKENS env var.`);
    }

    // Build single bulk prompt with all pending findings
    const pendingFindings = pendingIndices.map(i => findings[i]);
    const { system, user } = this.buildBulkAssessmentPrompt(pendingFindings);

    options.onProgress?.(0.1, `Sending ${pendingIndices.length} findings to LLM in single call...`);

    try {
      // Single LLM call for all findings
      console.log(`[LLM] Bulk mode: Making single LLM call for ${pendingIndices.length} findings`);
      console.log(`[LLM] Bulk mode: Prompt size - system: ${system.length} chars, user: ${user.length} chars`);
      const response = await this.generate(user, system);
      console.log(`[LLM] Bulk mode: Received response, length: ${response.length}`);
      options.onProgress?.(0.5, 'Received LLM response, parsing assessments...');

      // Parse JSON array response
      const assessments = this.parseBulkAssessments(response, pendingIndices.length);

      // Map assessments back to original indices
      for (let i = 0; i < pendingIndices.length; i++) {
        const originalIdx = pendingIndices[i];
        if (originalIdx !== undefined && assessments[i]) {
          results[originalIdx] = assessments[i];
        }
      }

      // Fill any missing assessments with default
      for (let i = 0; i < findings.length; i++) {
        if (!results[i]) {
          results[i] = {
            riskLevel: 'medium',
            isFalsePositive: false,
            falsePositiveReason: '',
            explanation: 'Assessment not available',
            recommendation: 'investigate',
          };
        }
      }

      options.onProgress?.(1.0, `Complete: 1 LLM call for ${findings.length} findings (${fastAssessedCount} fast-assessed)`);
      return results;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Bulk assessment failed: ${errorMsg}. Falling back to strategic mode.`);
      options.onProgress?.(0.1, `Bulk mode failed, falling back to strategic sampling...`);

      // Fall back to strategic mode
      return this.strategicAssessFindings(findings, options);
    }
  }

  /**
   * Build a single prompt for bulk assessment of all findings
   */
  private buildBulkAssessmentPrompt(findings: Finding[]): { system: string; user: string } {
    const system = `You are a security analyst assessing VS Code extension findings for false positives.
Your task is to analyze multiple security findings and determine which are genuine concerns vs false positives.

Respond with a JSON array containing one assessment object per finding, in the same order provided.
Each assessment must contain:
- "risk_level": one of "critical", "high", "medium", "low", "none"
- "is_false_positive": boolean - true if this is almost certainly benign
- "false_positive_reason": string - if is_false_positive is true, explain why
- "explanation": 1-2 sentence factual explanation of what this code does
- "recommendation": "investigate", "likely_benign", or "dismiss"

Example response format:
[
  {"risk_level": "none", "is_false_positive": true, "false_positive_reason": "Standard license text", "explanation": "This is MIT license boilerplate.", "recommendation": "dismiss"},
  {"risk_level": "high", "is_false_positive": false, "false_positive_reason": "", "explanation": "Dynamic code execution with user input.", "recommendation": "investigate"}
]

If there are too many findings to assess completely, prioritize assessing the first N findings and indicate this in your response.`;

    // Group findings by category for better organization
    const byCategory: Record<string, Finding[]> = {};
    for (const finding of findings) {
      if (!byCategory[finding.category]) {
        byCategory[finding.category] = [];
      }
      byCategory[finding.category].push(finding);
    }

    // Use array join for efficient string building
    const parts: string[] = [`Assess ${findings.length} security findings for false positive likelihood:\n\n`];

    let findingNum = 0;
    for (const [category, catFindings] of Object.entries(byCategory)) {
      parts.push(`\n=== ${category} (${catFindings.length} findings) ===\n`);
      for (const finding of catFindings) {
        parts.push(`\n[${findingNum + 1}] ${finding.title}\n`);
        parts.push(`File: ${finding.location}\n`);
        parts.push(`Code:\n\`\`\`\n${finding.evidence.slice(0, 800)}\n\`\`\`\n`);
        findingNum++;
      }
    }

    parts.push(`\n\nRespond with a JSON array of ${findings.length} assessment objects, one per finding, in the exact order presented above.`);

    return { system, user: parts.join('') };
  }

  /**
   * Parse JSON array response from bulk assessment
   */
  private parseBulkAssessments(response: string, expectedCount: number): LlmAssessment[] {
    const assessments: LlmAssessment[] = [];

    try {
      // Try multiple approaches to extract JSON array
      let parsed: unknown[] = [];

      // Helper: try to fix common JSON issues and parse
      const tryParse = (text: string): unknown[] | null => {
        try {
          return JSON.parse(text) as unknown[];
        } catch {
          // Try fixing trailing commas before closing brackets
          const fixed = text.replace(/,(\s*[}\]])/g, '$1');
          try {
            return JSON.parse(fixed) as unknown[];
          } catch {
            return null;
          }
        }
      };

      // Approach 1: Try direct parse with fix
      console.log(`[LLM] Bulk parse: Response starts with "${response.slice(0, 50)}..."`);
      parsed = tryParse(response) || [];
      if (parsed.length > 0) {
        console.log(`[LLM] Bulk mode: Direct parse succeeded with ${parsed.length} items`);
      } else {
        console.log(`[LLM] Bulk parse: Direct parse failed, trying regex...`);
        // Approach 2: Try regex extraction with fix - handle markdown code blocks
        // First strip markdown formatting
        const cleaned = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        console.log(`[LLM] Bulk parse: Cleaned response starts with "${cleaned.slice(0, 30)}..."`);

        const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          console.log(`[LLM] Bulk parse: Regex found array, length ${jsonMatch[0].length}`);
          parsed = tryParse(jsonMatch[0]) || [];
          if (parsed.length > 0) {
            console.log(`[LLM] Bulk mode: Regex extract succeeded with ${parsed.length} items`);
          }
        } else {
          console.log(`[LLM] Bulk parse: Regex found no array in cleaned text`);
        }
      }

      if (parsed.length === 0) {
        console.log(`[LLM] Bulk parse: All approaches failed, response length: ${response.length}`);
        throw new Error('No JSON array found in response');
      }

      console.log(`[LLM] Bulk mode: Parsed ${parsed.length} assessments from response (expected ${expectedCount})`);

      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue;

        const obj = item as Record<string, unknown>;
        assessments.push({
          riskLevel: (obj.riskLevel || obj.risk_level || 'medium') as LlmAssessment['riskLevel'],
          isFalsePositive: (obj.isFalsePositive ?? obj.is_false_positive ?? false) as boolean,
          falsePositiveReason: (obj.falsePositiveReason || obj.false_positive_reason || '') as string,
          explanation: (obj.explanation || '') as string,
          recommendation: (obj.recommendation || 'investigate') as LlmAssessment['recommendation'],
        });
      }
    } catch (error) {
      console.warn('Failed to parse bulk assessments:', error);
      // Return empty array to trigger fallback
    }

    // If we got fewer assessments than expected, the LLM may have truncated
    // Fill remaining with default assessments
    while (assessments.length < expectedCount) {
      assessments.push({
        riskLevel: 'medium',
        isFalsePositive: false,
        falsePositiveReason: '',
        explanation: 'Assessment not available (response truncated or parse error)',
        recommendation: 'investigate',
      });
    }

    return assessments;
  }

  /**
   * Triage batch mode: groups findings into tiered batches.
   * Tier A (max 5/batch): prompt_injection, malicious_agent_instructions, obfuscation, credentials
   * Tier B (max 20/batch): everything else
   * Falls back to individual assessFinding for any finding missing from the LLM response.
   */
  private async triageBatchAssess(
    findings: Finding[],
    options: {
      onProgress?: (progress: number, message: string) => void;
      extensionName?: string;
      concurrencyLimit?: number;
    } = {}
  ): Promise<LlmAssessment[]> {
    const results: LlmAssessment[] = new Array(findings.length);
    const pendingIndices: number[] = [];

    // First pass: fast heuristic
    for (let i = 0; i < findings.length; i++) {
      const fastResult = this.fastAssessor.assess(findings[i]);
      if (fastResult) {
        results[i] = fastResult;
      } else {
        pendingIndices.push(i);
      }
    }

    const fastCount = findings.length - pendingIndices.length;
    options.onProgress?.(0.05, `Fast assessed ${fastCount}/${findings.length}. ${pendingIndices.length} need triage batch.`);

    if (pendingIndices.length === 0) return results;

    const TIER_A_CATEGORIES = new Set(['prompt_injection', 'malicious_agent_instructions', 'obfuscation', 'credentials']);
    const TIER_A_MAX = 5;
    const TIER_B_MAX = 20;

    // Split into tier A and tier B
    const tierA: number[] = [];
    const tierB: number[] = [];
    for (const idx of pendingIndices) {
      if (TIER_A_CATEGORIES.has(findings[idx].category)) {
        tierA.push(idx);
      } else {
        tierB.push(idx);
      }
    }

    // Chunk into batches
    const batches: { indices: number[]; tier: string }[] = [];
    for (let i = 0; i < tierA.length; i += TIER_A_MAX) {
      batches.push({ indices: tierA.slice(i, i + TIER_A_MAX), tier: 'A' });
    }
    for (let i = 0; i < tierB.length; i += TIER_B_MAX) {
      batches.push({ indices: tierB.slice(i, i + TIER_B_MAX), tier: 'B' });
    }

    console.log(`[LLM] Triage batch: ${batches.length} batches (${tierA.length} tier-A, ${tierB.length} tier-B)`);

    const triagePrompt = this.prompts.triage_batch!;
    let totalProcessed = 0;

    for (const batch of batches) {
      options.onProgress?.(
        0.1 + (totalProcessed / pendingIndices.length) * 0.8,
        `Triage batch tier ${batch.tier}: ${batch.indices.length} findings`
      );

      // Build findingsJson for this batch
      const findingsJson = batch.indices.map(idx => {
        const f = findings[idx];
        return {
          index: idx,
          category: f.category,
          title: f.title,
          location: f.location,
          evidence: f.evidence.slice(0, 1500),
          file_type: f.fileType || 'unknown',
          is_minified: f.isMinified || false,
          probable_origin: f.probableOrigin || 'unknown',
          match_highlight: f.matchHighlight || '',
          neighboring_imports: f.neighboringImports || 'None found',
          priority: batch.tier === 'A' ? 'high' : 'normal',
          pattern_risk: f.riskLevel,
        };
      });

      const system = triagePrompt.system;
      const user = triagePrompt.user
        .replace('{findingsJson}', JSON.stringify(findingsJson, null, 2))
        .replace('{extensionName}', options.extensionName || 'Unknown');

      const response = await this.generate(user, system);

      // Parse response — expect JSON array with index field per assessment
      const assessed = new Set<number>();
      try {
        const arrayMatch = response.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          const parsed = JSON.parse(arrayMatch[0]) as Array<Record<string, unknown>>;
          for (const item of parsed) {
            const idx = item.index as number;
            if (idx !== undefined && batch.indices.includes(idx)) {
              results[idx] = {
                riskLevel: (item.riskLevel || item.risk_level || 'unknown') as LlmAssessment['riskLevel'],
                isFalsePositive: (item.isFalsePositive ?? item.is_false_positive ?? false) as boolean,
                falsePositiveReason: (item.falsePositiveReason || item.false_positive_reason || '') as string,
                explanation: (item.explanation || '') as string,
                recommendation: (item.recommendation || 'investigate') as LlmAssessment['recommendation'],
                injectionDetected: (item.injectionDetected ?? item.injection_detected ?? false) as boolean,
              };
              assessed.add(idx);
            }
          }
        }
      } catch (error) {
        console.warn(`[LLM] Triage batch parse failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Fall back to individual assessment for any missing findings (sequential with concurrency limiter)
      const missing = batch.indices.filter(idx => !assessed.has(idx));
      if (missing.length > 0) {
        console.warn(`[LLM] Triage batch: ${missing.length} findings missing, falling back to individual assessment (sequential)`);
        for (const idx of missing) {
          try {
            const result = await this.concurrencyLimiter.run(() => this.assessFinding(findings[idx]));
            results[idx] = result;
          } catch {
            results[idx] = {
              riskLevel: findings[idx].riskLevel as LlmAssessment['riskLevel'],
              isFalsePositive: false,
              falsePositiveReason: '',
              explanation: 'Individual assessment fallback failed',
              recommendation: 'investigate' as const,
            };
          }
        }
      }

      totalProcessed += batch.indices.length;
    }

    // Fill any remaining gaps
    for (let i = 0; i < findings.length; i++) {
      if (!results[i]) {
        results[i] = {
          riskLevel: findings[i].riskLevel as LlmAssessment['riskLevel'],
          isFalsePositive: false,
          falsePositiveReason: '',
          explanation: 'LLM assessment unavailable — retaining original risk level',
          recommendation: 'investigate',
        };
      }
    }

    // Consensus pass: for high/critical pattern_risk findings, run 2 more calls and merge
    const consensusIndices = pendingIndices.filter(idx => {
      const risk = findings[idx].riskLevel?.toLowerCase();
      return risk === 'high' || risk === 'critical';
    });

    if (consensusIndices.length > 0) {
      options.onProgress?.(0.90, `Consensus pass: ${consensusIndices.length} high/critical findings`);
      console.log(`[Consensus] Triage batch consensus pass: ${consensusIndices.length} findings need quorum`);

      // Use concurrency limiter to avoid 429 errors
      for (const idx of consensusIndices) {
        const finding = findings[idx];
        const firstVote = results[idx]; // Already have 1 vote from triage batch

        try {
          const { system, user } = this.buildFindingPrompt(finding);

          // Use concurrency limiter for the 2 additional votes
          const resp2 = await this.concurrencyLimiter.run(() => this.generate(user, system));
          const resp3 = await this.concurrencyLimiter.run(() => this.generate(user, system));

          const vote2 = parseSingleAssessment(resp2);
          const vote3 = parseSingleAssessment(resp3);

          const allVotes = [firstVote, vote2, vote3].filter((v): v is LlmAssessment => !!v);
          if (allVotes.length >= 2) {
            results[idx] = mergeConsensusAssessments(allVotes);
          }
        } catch {
          // Keep the triage batch result if consensus fails
        }
      }

      console.log(`[Consensus] Triage consensus complete: ${consensusIndices.length} findings, ${consensusIndices.filter(idx => results[idx].consensus?.splitDecision).length} split decisions`);
    }

    options.onProgress?.(0.95, `Complete: ${batches.length} triage batches for ${findings.length} findings`);
    return results;
  }

  /**
   * Strategic assessment mode (original implementation)
   * Groups by pattern and file, uses diverse sampling
   */
  private async strategicAssessFindings(
    findings: Finding[],
    options: {
      onProgress?: (progress: number, message: string) => void;
    } = {}
  ): Promise<LlmAssessment[]> {
    console.log(`[LLM] Strategic mode: Processing ${findings.length} findings`);
    const results: LlmAssessment[] = new Array(findings.length);
    const pendingIndices: number[] = [];

    // First pass: fast heuristic assessment
    for (let i = 0; i < findings.length; i++) {
      const fastResult = this.fastAssessor.assess(findings[i]);
      if (fastResult) {
        results[i] = fastResult;
      } else {
        pendingIndices.push(i);
      }
    }

    const pendingFindings = pendingIndices.map(i => findings[i]);
    const estimate = estimateStrategicLlmCalls(pendingFindings);
    options.onProgress?.(0.05, `Fast assessed ${findings.length - pendingIndices.length}/${findings.length}. ${pendingIndices.length} need LLM review (~${estimate.calls} calls, ${estimate.sampled} sampled)`);

    if (pendingIndices.length === 0) {
      return results;
    }

    // Group by pattern and file for strategic sampling
    const patterns = groupFindingsByPatternAndFile(pendingFindings);

    let totalProcessed = 0;
    let totalLlmCalls = 0;
    const concurrency = this.concurrency;

    // Flatten patterns and file groups for parallel processing
    const allFileGroups = patterns.flatMap(p => 
      p.fileGroups.map(fg => ({ pattern: p, fileGroup: fg }))
    );

    // Process file groups with concurrency limiting to avoid 429 errors
    for (let i = 0; i < allFileGroups.length; i += concurrency) {
      const batch = allFileGroups.slice(i, i + concurrency);
      
      // Process batch sequentially using concurrency limiter
      const batchResults: Array<{ assessments: Map<number, LlmAssessment>; llmCalls: number; fileGroup: FileGroup }> = [];
      for (const { pattern, fileGroup } of batch) {
        const result = await this.concurrencyLimiter.run(() => 
          this.processFileGroupForStrategic(pattern, fileGroup)
        );
        batchResults.push(result);
      }

      // Merge results from batch
      for (const result of batchResults) {
        const { assessments, llmCalls, fileGroup } = result;
        for (const [groupIdx, assessment] of assessments) {
          const originalIdx = pendingIndices[groupIdx];
          if (originalIdx !== undefined) {
            results[originalIdx] = assessment;
          }
        }
        totalProcessed += fileGroup.findings.length;
        totalLlmCalls += llmCalls;
      }
    }

    // Fill any missing assessments with a conservative default
    for (let i = 0; i < findings.length; i++) {
      if (!results[i]) {
        console.warn(`[LLM] Finding ${i} (${findings[i].title} in ${findings[i].location}) has no assessment — defaulting to investigate`);
        results[i] = {
          riskLevel: findings[i].riskLevel as LlmAssessment['riskLevel'],
          isFalsePositive: false,
          falsePositiveReason: '',
          explanation: 'LLM assessment unavailable — retaining original risk level',
          recommendation: 'investigate',
        };
      }
    }

    options.onProgress?.(0.95, `Complete: ${totalLlmCalls} LLM calls for ${findings.length} findings`);
    return results;
  }

  /**
   * Build system + user prompts for a single finding assessment.
   */
  private buildFindingPrompt(finding: Finding): { system: string; user: string } {
    const promptConfig = this.prompts.finding_assessment;

    let system = promptConfig.system;
    if (promptConfig.common_false_positives || promptConfig.genuine_concerns) {
      system += '\n\n';
      if (promptConfig.common_false_positives) {
        system += promptConfig.common_false_positives.slice(0, 2000) + '\n\n';
      }
      if (promptConfig.genuine_concerns) {
        system += promptConfig.genuine_concerns.slice(0, 2000);
      }
    }

    const user = promptConfig.user
      .replace('{category}', finding.category)
      .replace('{title}', finding.title)
      .replace('{location}', finding.location)
      .replace('{pattern_risk}', finding.riskLevel)
      .replace('{evidence}', finding.evidence.slice(0, 1500))
      .replace('{file_type}', finding.fileType || 'unknown')
      .replace('{is_minified}', String(finding.isMinified || false))
      .replace('{probable_origin}', finding.probableOrigin || 'unknown')
      .replace('{match_highlight}', finding.matchHighlight || '')
      .replace('{neighboring_imports}', finding.neighboringImports || 'None found');

    return { system, user };
  }

  /**
   * Process a single file group for strategic assessment mode.
   * Returns assessments map, LLM call count, and fileGroup reference.
   */
  private async processFileGroupForStrategic(
    pattern: PatternGroup,
    fileGroup: FileGroup
  ): Promise<{ assessments: Map<number, LlmAssessment>; llmCalls: number; fileGroup: FileGroup }> {
    const sampleSize = calculateSecuritySampleSize(pattern, fileGroup);
    const samples = selectDiverseSamples(fileGroup, sampleSize);

    // Build strategic prompt
    const { system, user } = buildStrategicBulkPrompt(pattern, samples, this.prompts);

    const useConsensus = pattern.risk === 'high' || pattern.risk === 'critical';
    let assessments: Map<number, LlmAssessment>;
    let llmCalls = 0;

    if (useConsensus) {
      // Consensus mode: 3 calls, merge per-finding via majority vote
      // Use concurrency limiter to avoid 429 errors
      console.log(`[Consensus] Quorum for ${pattern.category}/${pattern.patternName} (${pattern.risk} risk, ${samples.length} findings)`);
      const runs: string[] = [];
      for (let i = 0; i < 3; i++) {
        const response = await this.concurrencyLimiter.run(() => this.generate(user, system));
        runs.push(response);
      }
      llmCalls = 3;

      const parsed = runs.map(r => parseStrategicAssessments(r, samples));

      // Merge: for each index present in any run, collect assessments and vote
      const allIndices = new Set<number>();
      for (const m of parsed) for (const k of m.keys()) allIndices.add(k);

      assessments = new Map();
      for (const idx of allIndices) {
        const candidates = parsed.map(m => m.get(idx)).filter((a): a is LlmAssessment => !!a);
        assessments.set(idx, candidates.length >= 2 ? mergeConsensusAssessments(candidates) : candidates[0]);
      }
      console.log(`[Consensus] Merged ${assessments.size} findings, ${[...assessments.values()].filter(a => a.consensus?.splitDecision).length} split decisions`);
    } else {
      const response = await this.concurrencyLimiter.run(() => this.generate(user, system));
      llmCalls = 1;
      assessments = parseStrategicAssessments(response, samples);
    }

    return { assessments, llmCalls, fileGroup };
  }

  /**
   * Assess a single finding
   */
  async assessFinding(finding: Finding): Promise<LlmAssessment> {
    const { system, user } = this.buildFindingPrompt(finding);

    const useConsensus = finding.riskLevel === 'high' || finding.riskLevel === 'critical';

    if (useConsensus) {
      console.log(`[Consensus] Individual quorum for "${finding.title}" at ${finding.location} (${finding.riskLevel} risk)`);
      // Use concurrency limiter to avoid 429 errors
      const responses: string[] = [];
      for (let i = 0; i < 3; i++) {
        const response = await this.concurrencyLimiter.run(() => this.generate(user, system));
        responses.push(response);
      }
      const candidates = responses.map(r => parseSingleAssessment(r)).filter((a): a is LlmAssessment => !!a);
      if (candidates.length >= 2) return mergeConsensusAssessments(candidates);
      if (candidates.length === 1) return candidates[0];
    } else {
      const response = await this.concurrencyLimiter.run(() => this.generate(user, system));
      const result = parseSingleAssessment(response);
      if (result) return result;
    }

    return {
      riskLevel: 'medium',
      isFalsePositive: false,
      falsePositiveReason: '',
      explanation: 'Unable to assess',
      recommendation: 'investigate',
      injectionDetected: false,
    };
  }
  
  /**
   * Compute display string for activation events (same logic as report.ts)
   */
  private computeActivationEventsDisplay(result: { activationEvents?: string[]; contributes?: Record<string, unknown> }): string {
    const activationEvents = Array.isArray(result.activationEvents) ? result.activationEvents : [];
    const contributes = result.contributes as Record<string, unknown> | undefined;

    // If activationEvents has entries, join them with commas
    if (activationEvents.length > 0) {
      return activationEvents.join(', ');
    }

    // Check for contributed commands and views
    const hasCommands = contributes?.commands && Array.isArray(contributes.commands) && contributes.commands.length > 0;
    const hasViews = contributes?.views && Object.keys(contributes.views).length > 0;

    if (hasCommands || hasViews) {
      return 'Implicit (activates via contributed commands and views)';
    }

    // Default: activates on startup
    return '* (activates on startup)';
  }

  /**
   * Generate executive summary
   */
  async generateExecutiveSummary(result: {
    extensionName: string;
    version: string;
    publisher: string;
    description?: string;
    repository?: string;
    homepage?: string;
    activationEvents?: string[];
    contributes?: Record<string, unknown>;
    findings: Finding[];
    notableDependencies: Record<string, string>;
    telemetryConfig?: Record<string, unknown>;
    endpoints?: Array<{ url: string; file: string; line: number; tag?: string }>;
    jsFiles?: string[];
  }, extensionPath: string): Promise<string> {
    // Limit findings for executive summary to avoid memory issues
    const MAX_FINDINGS_FOR_SUMMARY = 100;
    const findingsForSummary = result.findings.slice(0, MAX_FINDINGS_FOR_SUMMARY);
    const hasMoreFindings = result.findings.length > MAX_FINDINGS_FOR_SUMMARY;

    // Build findings by category
    const categoryCounts: Record<string, number> = {};
    for (const f of findingsForSummary) {
      categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
    }

    // Add note if there are more findings not included
    if (hasMoreFindings) {
      categoryCounts['(additional findings truncated)'] = result.findings.length - MAX_FINDINGS_FOR_SUMMARY;
    }

    const findingsByCategory = Object.entries(categoryCounts)
      .map(([cat, count]) => `${cat}: ${count}`)
      .join(', ');

    // Use configurable prompts with template substitution
    const promptConfig = this.prompts.executive_summary;

    // Safely handle potentially missing fields
    const extensionDescription = result.description || 'Not specified';
    // Compute activation events display - same logic as report.ts
    const activationEvents = this.computeActivationEventsDisplay(result);

    // Build telemetryServices: one line per telemetry finding that's not a false positive
    // Format: "ServiceName (type) — file:line"
    // Map pattern names to friendly service names
    const TELEMETRY_SERVICE_MAP: Record<string, string> = {
      segment: 'Segment (analytics)',
      mixpanel: 'Mixpanel (analytics)',
      ga: 'Google Analytics',
      telemetry_reporter: 'VS Code Telemetry Reporter',
      posthog: 'PostHog (analytics)',
      amplitude: 'Amplitude (analytics)',
      sentry: 'Sentry (error reporting)',
    };

    const telemetryFindings = result.findings?.filter(
      f => f.category === 'telemetry' && !f.isFalsePositive
    ) || [];

    // Deduplicate by pattern name, keeping first occurrence
    const seenPatterns = new Set<string>();
    const uniqueTelemetryFindings = telemetryFindings.filter(f => {
      const patternKey = f.patternName || f.title?.toLowerCase().replace(/\s/g, '_');
      if (seenPatterns.has(patternKey)) return false;
      seenPatterns.add(patternKey);
      return true;
    });

    const telemetryServices = uniqueTelemetryFindings.length > 0
      ? uniqueTelemetryFindings.map(f => {
          const loc = f.location || 'unknown:0';
          const patternKey = f.patternName || '';
          const serviceName = TELEMETRY_SERVICE_MAP[patternKey] || f.title || 'Unknown service';
          return `${serviceName} — ${loc}`;
        }).join('\n')
      : 'None detected';

    // Build endpointsList using endpoint_filtering rules from patterns.yaml
    const patternsPath = join(__dirname, '..', '..', 'docs', 'patterns.yaml');
    const filteringConfig = getEndpointFiltering(patternsPath);
    const excludedDomains = filteringConfig.excluded_domains || [];
    const excludedUrlPatterns = (filteringConfig.excluded_url_patterns || []).map(
      (p: string) => new RegExp(p, 'i')
    );
    const classificationRules = filteringConfig.endpoint_classification || [];

    // Helper: check if hostname matches or is subdomain of excluded domain
    const isExcludedDomain = (hostname: string): boolean => {
      const normalized = hostname.toLowerCase();
      return excludedDomains.some(domain => {
        const d = domain.toLowerCase();
        return normalized === d || normalized.endsWith('.' + d);
      });
    };

    // Filter endpoints: 1) exclude pkg.json metadata, 2) domain filter, 3) URL pattern filter
    const pkgUrls = new Set<string>();
    if (result.repository) {
      try {
        const repoUrl = new URL(result.repository);
        pkgUrls.add(repoUrl.hostname + repoUrl.pathname);
      } catch { /* ignore invalid URLs */ }
    }
    if (result.homepage) {
      try {
        const hpUrl = new URL(result.homepage);
        pkgUrls.add(hpUrl.hostname + hpUrl.pathname);
      } catch { /* ignore invalid URLs */ }
    }

    const filteredEndpoints = (result.endpoints as EndpointInfo[] || []).filter((ep) => {
      try {
        const epUrl = new URL(ep.url);
        const epPath = epUrl.hostname + epUrl.pathname;

        // Filter 1: Skip package.json metadata URLs
        if (pkgUrls.has(epPath) || pkgUrls.has(epUrl.hostname)) {
          return false;
        }

        // Filter 2: Domain filter (operational endpoints bypass this)
        if (!ep.operational && isExcludedDomain(epUrl.hostname)) {
          return false;
        }

        // Filter 3: URL pattern filter
        for (const pattern of excludedUrlPatterns) {
          if (pattern.test(ep.url)) {
            return false;
          }
        }

        return true;
      } catch {
        return false; // drop if URL parsing fails
      }
    });

    // Classify survivors using endpoint_classification rules
    const classifyEndpoint = (url: string): string => {
      try {
        const epUrl = new URL(url);
        for (const rule of classificationRules) {
          // Check host_patterns
          if (rule.host_patterns) {
            const hostMatch = rule.host_patterns.some((hp: string) => {
              const hpRegex = new RegExp(hp, 'i');
              return hpRegex.test(epUrl.hostname);
            });
            if (hostMatch) return rule.tag;
          }
          // Check url_patterns
          if (rule.url_patterns) {
            const urlMatch = rule.url_patterns.some((up: string) => {
              const upRegex = new RegExp(up, 'i');
              return upRegex.test(url);
            });
            if (urlMatch) return rule.tag;
          }
        }
      } catch { /* ignore invalid URL */ }
      return 'unclassified';
    };

    const endpointsList = filteredEndpoints.length > 0
      ? filteredEndpoints.map(ep => {
          const tag = classifyEndpoint(ep.url);
          const loc = `${ep.file}:${ep.line}`;
          return `${ep.url} [${tag}] — ${loc}`;
        }).join('\n')
      : 'None detected';

    // Build the prompt template without sourceFiles — we'll substitute per-chunk
    const userTemplate = promptConfig.user
      .replace('{extensionName}', result.extensionName || 'Unknown')
      .replace('{version}', result.version || '0.0.0')
      .replace('{publisher}', result.publisher || 'Unknown')
      .replace('{extensionDescription}', extensionDescription)
      .replace('{activationEvents}', activationEvents)
      .replace('{findingsCount}', String(result.findings.length))
      .replace('{findingsByCategory}', findingsByCategory)
      .replace('{notableDependencies}', Object.keys(result.notableDependencies).join(', ') || 'None flagged')
      .replace('{bundledDependencies}', (result as AnalysisResult).bundledDependencies?.join(', ') || 'None detected')
      .replace('{telemetryServices}', telemetryServices)
      .replace('{endpointsList}', endpointsList)
      .replace('{totalFiles}', String(result.jsFiles?.length || 0));

    const sourceChunks = chunkSourceFiles(result.findings, extensionPath);

    // Single chunk — standard path
    if (sourceChunks.length <= 1) {
      const user = userTemplate.replace('{sourceFiles}', sourceChunks[0] || '');
      return this.generate(user, promptConfig.system);
    }

    // Multiple chunks — generate partial summaries then merge
    console.log(`[LLM] Executive summary: splitting ${sourceChunks.length} source chunks`);
    const partialSummaries: string[] = [];

    for (let i = 0; i < sourceChunks.length; i++) {
      const chunkLabel = `[Source chunk ${i + 1}/${sourceChunks.length}]`;
      const user = userTemplate.replace('{sourceFiles}', `${chunkLabel}\n${sourceChunks[i]}`);
      const partial = await this.generate(user, promptConfig.system);
      if (partial) partialSummaries.push(partial);
    }

    if (partialSummaries.length === 0) return '';
    if (partialSummaries.length === 1) return partialSummaries[0];

    // Merge partial summaries into a single cohesive executive summary
    // Instruct the merge to also emit a VERDICT line (the partials each have one)
    const mergePrompt = `You previously analyzed a VS Code extension "${result.extensionName}" in ${sourceChunks.length} parts due to its size. Below are your partial security summaries. Merge them into a single cohesive executive summary. Your first line MUST be a verdict in the format "VERDICT: CLEAN", "VERDICT: SUSPICIOUS", or "VERDICT: MALICIOUS" — choose the most severe verdict from the partials. Then write 2-3 paragraphs of neutral prose (no bullet points, no tables, no headers). Deduplicate observations and preserve all security-relevant details.\n\n${partialSummaries.map((s, i) => `--- Part ${i + 1} ---\n${s}`).join('\n\n')}`;

    return this.generate(mergePrompt, promptConfig.system);
  }
}

// Verdict severity for majority vote tie-breaking
const VERDICT_ORDER: Record<string, number> = { MALICIOUS: 2, SUSPICIOUS: 1, CLEAN: 0 };

/**
 * Multi-model consensus orchestrator.
 * Coordinates a main LlmClient with 0-2 judge LlmClients.
 * When no judges are configured, delegates directly to mainClient (identical to single-model behavior).
 */
export class ConsensusOrchestrator {
  private mainClient: LlmClient;
  private judges: LlmClient[];
  private consensusConfig: ConsensusConfig;

  constructor(mainClient: LlmClient, judges: LlmClient[], consensusConfig: ConsensusConfig) {
    this.mainClient = mainClient;
    this.judges = judges.filter(j => j !== null);
    this.consensusConfig = consensusConfig;
    console.log(`[Orchestrator] Initialized: main + ${this.judges.length} judge(s), allFindings=${consensusConfig.judgesValidateAllFindings}`);
  }

  async isAvailable(): Promise<boolean> {
    return this.mainClient.isAvailable();
  }

  /**
   * Verify all configured judges are reachable. Throws if any required judge is down.
   */
  async verifyJudges(): Promise<void> {
    for (const judge of this.judges) {
      const available = await judge.isAvailable();
      if (!available) {
        throw new Error(`Judge model is not reachable. Disable the judge or fix the connection before running LLM analysis.`);
      }
    }
  }

  /**
   * Batch assess findings with multi-model consensus.
   * All models (main + judges) assess findings in parallel, then results are filtered and merged.
   */
  async batchAssessFindings(
    findings: Finding[],
    options: { onProgress?: (progress: number, message: string) => void; extensionName?: string } = {}
  ): Promise<LlmAssessment[]> {
    // No judges → delegate entirely to main (preserves existing same-model 3x consensus)
    if (this.judges.length === 0) {
      return this.mainClient.batchAssessFindings(findings, options);
    }

    // Step 1: Launch all models in parallel — main + all judges assess the full finding set
    const totalModels = 1 + this.judges.length;
    const perModelProgress = new Array<number>(totalModels).fill(0);

    const reportOverallProgress = (modelIndex: number, p: number, m: string) => {
      perModelProgress[modelIndex] = p;
      const overall = perModelProgress.reduce((sum, v) => sum + v, 0) / totalModels;
      options.onProgress?.(overall * 0.95, m); // Reserve 0.95-1.0 for merge step
    };

    options.onProgress?.(0, `${totalModels} model(s) assessing ${findings.length} findings in parallel...`);
    const perModelConcurrency = Math.max(1, Math.ceil(this.mainClient.concurrency / totalModels));

    const allResults = await Promise.all([
      // Main model
      this.mainClient.batchAssessFindings(findings, {
        onProgress: (p, m) => reportOverallProgress(0, p, `[Main] ${m}`),
        extensionName: options.extensionName,
        concurrencyLimit: perModelConcurrency,
      }),
      // Judges — each wrapped with catch for graceful degradation
      ...this.judges.map((judge, jIdx) =>
        judge.batchAssessFindings(findings, {
          onProgress: (p, m) => reportOverallProgress(1 + jIdx, p, `[Judge ${jIdx + 1}] ${m}`),
          extensionName: options.extensionName,
          concurrencyLimit: perModelConcurrency,
        }).catch((err): null => {
          const judgeLabel = `Judge ${jIdx + 1}`;
          options.onProgress?.(perModelProgress.reduce((s, v) => s + v, 0) / totalModels, `[${judgeLabel}] failed: ${err?.message ?? err}`);
          return null; // Graceful degradation — continue without this judge
        })
      ),
    ]);

    const mainAssessments = allResults[0] as LlmAssessment[];
    const judgeResults = allResults.slice(1) as (LlmAssessment[] | null)[];

    // Step 2: Determine which findings need consensus merge
    const judgeIndices: number[] = [];
    for (let i = 0; i < mainAssessments.length; i++) {
      if (this.consensusConfig.judgesValidateAllFindings) {
        judgeIndices.push(i);
      } else {
        // Check if ANY model rated this finding HIGH/CRITICAL
        const risks = [mainAssessments[i].riskLevel?.toLowerCase()];
        for (const jr of judgeResults) {
          if (jr?.[i]) risks.push(jr[i].riskLevel?.toLowerCase());
        }
        if (risks.some(r => r === 'high' || r === 'critical')) {
          judgeIndices.push(i);
        }
      }
    }

    if (judgeIndices.length === 0) {
      options.onProgress?.(1, 'No findings require consensus merge');
      return mainAssessments;
    }

    // Step 3: Merge main + judge votes for each finding that needs consensus
    for (let j = 0; j < judgeIndices.length; j++) {
      const idx = judgeIndices[j];
      const allVotes: LlmAssessment[] = [mainAssessments[idx]];
      const modelIds: string[] = ['main'];

      for (let jIdx = 0; jIdx < judgeResults.length; jIdx++) {
        if (judgeResults[jIdx]?.[idx]) {
          allVotes.push(judgeResults[jIdx]![idx]);
          modelIds.push(`judge${jIdx + 1}`);
        }
      }

      if (allVotes.length >= 2) {
        mainAssessments[idx] = mergeConsensusAssessments(allVotes);
        // Stamp modelId on votes
        if (mainAssessments[idx].consensus) {
          mainAssessments[idx].consensus!.votes = mainAssessments[idx].consensus!.votes.map((v, vi) => ({
            ...v,
            modelId: modelIds[vi] || `model${vi}`,
          }));
        }
      }
    }

    options.onProgress?.(1, `Consensus complete: ${judgeIndices.length} findings reviewed by ${totalModels} models`);
    return mainAssessments;
  }

  /**
   * Generate executive summary with multi-model verdict consensus.
   * Each model generates independently. Verdict = majority vote. Prose from winning model.
   */
  async generateExecutiveSummary(result: Parameters<LlmClient['generateExecutiveSummary']>[0], extensionPath: string): Promise<string> {
    // No judges → delegate to main
    if (this.judges.length === 0) {
      return this.mainClient.generateExecutiveSummary(result, extensionPath);
    }

    // All models generate in parallel
    const summaries = await Promise.all([
      this.mainClient.generateExecutiveSummary(result, extensionPath),
      ...this.judges.map(j => j.generateExecutiveSummary(result, extensionPath)),
    ]);

    const parsed = summaries
      .filter(s => s && s.trim())
      .map(s => parseVerdictFromSummary(s));

    if (parsed.length === 0) return '';
    if (parsed.length === 1) return summaries[0];

    // Majority vote on verdict, tie-break toward higher severity
    const verdictCounts = new Map<string, number>();
    for (const p of parsed) {
      verdictCounts.set(p.verdict, (verdictCounts.get(p.verdict) || 0) + 1);
    }
    const maxCount = Math.max(...verdictCounts.values());
    const tied = [...verdictCounts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v);
    const winningVerdict = tied.sort((a, b) => (VERDICT_ORDER[b] ?? 0) - (VERDICT_ORDER[a] ?? 0))[0];

    // Pick prose from the model whose verdict matches (prefer main on ties)
    const winnerIdx = parsed.findIndex(p => p.verdict === winningVerdict);
    const prose = parsed[winnerIdx >= 0 ? winnerIdx : 0].prose;

    const modelLabels = ['Main', ...this.judges.map((_, i) => `Judge ${i + 1}`)];
    const verdictLog = parsed.map((p, i) => `${modelLabels[i]}=${p.verdict}`).join(', ');
    console.log(`[Orchestrator] Verdict consensus: [${verdictLog}] → ${winningVerdict}`);

    return `VERDICT: ${winningVerdict}\n${prose}`;
  }
}
