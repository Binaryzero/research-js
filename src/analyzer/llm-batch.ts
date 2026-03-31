/**
 * Strategic sampling for security analysis
 * Ensures diverse coverage rather than random selection
 */

import type { Finding, LlmAssessment } from '../types/index.js';
import type { PromptConfig } from '../config.js';

export interface FileGroup {
  filePath: string;
  findings: Finding[];
  indices: number[];
  isExtensionCode: boolean;
  isBundledDependency: boolean;
  isConfig: boolean;
}

export interface PatternGroup {
  patternName: string;
  category: string;
  risk: string;
  fileGroups: FileGroup[];
  totalCount: number;
}

interface SampledFinding {
  finding: Finding;
  originalIndex: number;
  fileGroup: FileGroup;
  reason: string; // Why this was selected
}

/**
 * Group findings by pattern, then by file
 * This ensures we don't miss a suspicious file that has many instances of a pattern
 */
export function groupFindingsByPatternAndFile(findings: Finding[]): PatternGroup[] {
  const patterns = new Map<string, PatternGroup>();

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const patternKey = `${finding.category}:${finding.title}`;

    if (!patterns.has(patternKey)) {
      patterns.set(patternKey, {
        patternName: finding.title,
        category: finding.category,
        risk: finding.riskLevel,
        fileGroups: [],
        totalCount: 0,
      });
    }

    const pattern = patterns.get(patternKey)!;
    const filePath = finding.location.split(':')[0]; // Remove line number

    // Find or create file group
    let fileGroup = pattern.fileGroups.find(fg => fg.filePath === filePath);
    if (!fileGroup) {
      fileGroup = {
        filePath,
        findings: [],
        indices: [],
        isExtensionCode: isExtensionCode(filePath),
        isBundledDependency: isBundledDependency(filePath),
        isConfig: isConfigFile(filePath),
      };
      pattern.fileGroups.push(fileGroup);
    }

    fileGroup.findings.push(finding);
    fileGroup.indices.push(i);
    pattern.totalCount++;
  }

  // Sort by risk (critical first), then by number of affected files
  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
  return Array.from(patterns.values()).sort((a, b) => {
    const riskDiff = (riskOrder[a.risk as keyof typeof riskOrder] || 5) -
                     (riskOrder[b.risk as keyof typeof riskOrder] || 5);
    if (riskDiff !== 0) return riskDiff;
    return b.fileGroups.length - a.fileGroups.length;
  });
}

/**
 * Determine if a file is extension code (not bundled)
 */
function isExtensionCode(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  // Not in node_modules, dist, or common bundle directories
  return !lower.includes('node_modules') &&
         !lower.includes('dist/') &&
         !lower.includes('out/') &&
         !lower.includes('webpack:') &&
         !lower.includes('bundled');
}

/**
 * Determine if a file is a bundled dependency
 */
function isBundledDependency(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.includes('node_modules') ||
         lower.includes('webpack:') ||
         lower.includes('bundled') ||
         /\bwebpack_require\b/.test(lower);
}

/**
 * Determine if a file is a config file
 */
function isConfigFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('package.json') ||
         lower.endsWith('.json') ||
         lower.endsWith('.yaml') ||
         lower.endsWith('.yml') ||
         lower.endsWith('.md');
}

/**
 * Calculate sample size based on risk and context
 * Critical patterns in extension code get full assessment
 * Bundled dependencies can be sampled more aggressively
 */
export function calculateSecuritySampleSize(
  _patternGroup: PatternGroup,
  fileGroup: FileGroup
): number {
  // Every finding must be individually assessed — sampling risks
  // missing the one malicious instance hidden among benign matches
  return fileGroup.findings.length;
}

/**
 * Select diverse samples from a file group
 * Prioritizes:
 * 1. First occurrence (context)
 2. Last occurrence (might be different)
 * 3. Evenly distributed samples
 * 4. Any with unique evidence (if detectable)
 */
export function selectDiverseSamples(
  fileGroup: FileGroup,
  sampleSize: number
): SampledFinding[] {
  const { findings, indices } = fileGroup;

  if (findings.length <= sampleSize) {
    return findings.map((f, i) => ({
      finding: f,
      originalIndex: indices[i],
      fileGroup,
      reason: 'all_assessed',
    }));
  }

  const selected = new Set<number>();
  const samples: SampledFinding[] = [];

  // Always include first occurrence (context setting)
  selected.add(0);
  samples.push({
    finding: findings[0],
    originalIndex: indices[0],
    fileGroup,
    reason: 'first_occurrence',
  });

  // Always include last occurrence (might be different context)
  if (sampleSize > 1) {
    const lastIdx = findings.length - 1;
    selected.add(lastIdx);
    samples.push({
      finding: findings[lastIdx],
      originalIndex: indices[lastIdx],
      fileGroup,
      reason: 'last_occurrence',
    });
  }

  // Fill remaining with evenly distributed samples
  const remaining = sampleSize - samples.length;
  if (remaining > 0) {
    const step = (findings.length - 1) / (remaining + 1);
    for (let i = 1; i <= remaining; i++) {
      const idx = Math.floor(i * step);
      if (!selected.has(idx)) {
        selected.add(idx);
        samples.push({
          finding: findings[idx],
          originalIndex: indices[idx],
          fileGroup,
          reason: 'distributed_sample',
        });
      }
    }
  }

  // Sort by original index to maintain order
  return samples.sort((a, b) => a.originalIndex - b.originalIndex);
}

/**
 * Build bulk assessment prompt with context about sampling strategy
 */
export function buildStrategicBulkPrompt(
  patternGroup: PatternGroup,
  samples: SampledFinding[],
  prompts: PromptConfig
): { system: string; user: string } {
  const system = `${prompts.finding_assessment.system}

You are assessing MULTIPLE findings of the SAME pattern type across potentially multiple files.
Each finding must be assessed individually — do NOT assume findings are benign because others are.
Respond with a JSON array where each element corresponds to the finding at that index.

Format:
[
  {
    "risk_level": "critical|high|medium|low|none",
    "is_false_positive": true|false,
    "false_positive_reason": "explanation if is_false_positive is true",
    "explanation": "1-2 sentence factual explanation",
    "recommendation": "investigate|likely_benign|dismiss",
    "origin": "extension_code|bundled_dependency|webview|config|unknown",
    "confidence": "high|medium|low"
  },
  ...
]`;

  // Group samples by file for clearer presentation
  const byFile = new Map<string, SampledFinding[]>();
  for (const sample of samples) {
    const file = sample.finding.location.split(':')[0];
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(sample);
  }

  let findingsList = '';
  let idx = 1;
  for (const [filePath, fileSamples] of byFile) {
    findingsList += `\n=== File: ${filePath} ===\n`;
    for (const sample of fileSamples) {
      findingsList += `\n[${idx++}] Location: ${sample.finding.location} (${sample.reason})\n`;
      findingsList += `Code:\n${sample.finding.evidence.slice(0, 600)}\n`;
    }
  }

  const filesAffected = patternGroup.fileGroups.length;

  const user = `Assess ALL ${samples.length} findings of pattern "${patternGroup.patternName}".

Context:
- Category: ${patternGroup.category}
- Base risk: ${patternGroup.risk}
- ${samples.length} findings across ${filesAffected} file(s)

${findingsList}

Respond with a JSON array of exactly ${samples.length} assessments, one per finding.`;

  return { system, user };
}

/**
 * Parse strategic assessments from LLM response
 */
export function parseStrategicAssessments(
  response: string,
  samples: SampledFinding[]
): Map<number, LlmAssessment> {
  const assessments = new Map<number, LlmAssessment>();

  try {
    // Try multiple approaches to extract JSON array from response
    let parsed: unknown[] = [];
    let jsonStr: string | null = null;

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

    // Approach 1: Try direct parse first
    parsed = tryParse(response) || [];
    if (parsed.length > 0 && Array.isArray(parsed)) {
      console.log(`[LLM] Strategic parse: Direct parse succeeded with ${parsed.length} items`);
    }

    // Approach 2: Try regex extraction if direct parse failed
    if (parsed.length === 0 || !Array.isArray(parsed)) {
      const arrayMatch = response.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonStr = arrayMatch[0];
        parsed = tryParse(jsonStr) || [];
        if (parsed.length > 0 && Array.isArray(parsed)) {
          console.log(`[LLM] Strategic parse: Regex extract succeeded with ${parsed.length} items`);
        }
      }
    }

    // Approach 3: Try to find JSON array after first '[' and before last ']'
    if (parsed.length === 0 || !Array.isArray(parsed)) {
      const firstBracket = response.indexOf('[');
      const lastBracket = response.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        jsonStr = response.slice(firstBracket, lastBracket + 1);
        parsed = tryParse(jsonStr) || [];
        if (parsed.length > 0 && Array.isArray(parsed)) {
          console.log(`[LLM] Strategic parse: Bracket extraction succeeded with ${parsed.length} items`);
        }
      }
    }

    // Approach 4: Extract individual JSON objects when array parsing fails
    if (parsed.length === 0 || !Array.isArray(parsed)) {
      const objects: unknown[] = [];
      let searchFrom = 0;
      while (searchFrom < response.length) {
        const objStart = response.indexOf('{', searchFrom);
        if (objStart === -1) break;
        let depth = 0;
        let objEnd = -1;
        for (let ci = objStart; ci < response.length; ci++) {
          if (response[ci] === '{') depth++;
          else if (response[ci] === '}') {
            depth--;
            if (depth === 0) { objEnd = ci + 1; break; }
          }
        }
        if (objEnd === -1) break;
        try {
          const obj = JSON.parse(response.slice(objStart, objEnd));
          if (obj && typeof obj === 'object') objects.push(obj);
        } catch { /* skip malformed */ }
        searchFrom = objEnd;
      }
      if (objects.length > 0) {
        parsed = objects;
        console.log(`[LLM] Strategic parse: Individual object extraction salvaged ${objects.length} items`);
      }
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.warn(`[LLM] Failed to parse JSON array from response (${response.length} chars)`);
      return assessments;
    }

    if (parsed.length < samples.length) {
      console.warn(`[LLM] Response contained ${parsed.length} assessments but expected ${samples.length}`);
    }

    for (let i = 0; i < parsed.length && i < samples.length; i++) {
      const item = parsed[i];
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      const sample = samples[i];

      assessments.set(sample.originalIndex, {
        riskLevel: (obj.riskLevel || obj.risk_level || 'unknown') as LlmAssessment['riskLevel'],
        isFalsePositive: (obj.isFalsePositive ?? obj.is_false_positive ?? false) as boolean,
        falsePositiveReason: (obj.falsePositiveReason || obj.false_positive_reason || '') as string,
        explanation: (obj.explanation || '') as string,
        recommendation: (obj.recommendation || 'investigate') as LlmAssessment['recommendation'],
      });
    }
  } catch (error) {
    console.warn(`[LLM] Error parsing strategic assessments: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return assessments;
}

/**
 * Estimate LLM calls with strategic sampling
 */
export function estimateStrategicLlmCalls(findings: Finding[]): { calls: number; sampled: number; total: number } {
  const patterns = groupFindingsByPatternAndFile(findings);
  let calls = 0;
  let sampled = 0;

  for (const pattern of patterns) {
    for (const fileGroup of pattern.fileGroups) {
      const sampleSize = calculateSecuritySampleSize(pattern, fileGroup);
      sampled += sampleSize;
      calls++;
    }
  }

  return { calls, sampled, total: findings.length };
}

/**
 * Get summary of sampling strategy for a pattern group
 */
export function getSamplingSummary(patternGroup: PatternGroup): string {
  const { totalCount, fileGroups } = patternGroup;
  let totalSampled = 0;
  let fullAssessmentFiles = 0;

  for (const fg of fileGroups) {
    const sampleSize = calculateSecuritySampleSize(patternGroup, fg);
    totalSampled += sampleSize;
    if (sampleSize === fg.findings.length) {
      fullAssessmentFiles++;
    }
  }

  if (totalSampled === totalCount) {
    return `Full assessment (${totalCount} findings in ${fileGroups.length} files)`;
  }

  return `${totalSampled}/${totalCount} sampled across ${fileGroups.length} files (${fullAssessmentFiles} files fully assessed)`;
}
