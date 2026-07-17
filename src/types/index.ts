/**
 * Core types for the Extension Security Analyzer
 * These mirror the Python dataclasses from analyzer.py
 */

export interface Finding {
  category: string;
  title: string;
  location: string;
  observation: string;
  evidence: string;
  lineStart: number;
  lineEnd: number;
  context: string;
  isFalsePositive: boolean;
  falsePositiveReason: string;
  riskLevel: string;
  // Pattern key that matched (e.g., "sentry", "segment")
  patternName?: string;
  // New fields for enhanced LLM assessment
  fileType?: string;
  isMinified?: boolean;
  probableOrigin?: 'extension_code' | 'bundled_dependency' | 'unknown';
  matchHighlight?: string;
  neighboringImports?: string;
  injectionDetected?: boolean;
  // LLM recommendation: investigate = needs human review, likely_benign = probably safe, dismiss = noise
  recommendation?: 'investigate' | 'likely_benign' | 'dismiss';
  // Consensus metadata — present when quorum (3x) was used for this finding
  consensus?: {
    votes: Array<{ riskLevel: string; isFalsePositive: boolean; recommendation: string; modelId?: string }>;
    unanimous: boolean;
    splitDecision: boolean;
  };
}

export interface BinaryInfo {
  path: string;
  sha256: string;
  size: number;
  architecture: string;
}

export interface FileStats {
  count: number;
  totalSize: number;
}

export interface FileInfo {
  path: string;
  extension: string;
  detectedType: string;
  description: string;
  size: number;
  category: string;
  confidence: string;
  mismatch?: boolean;
  mismatchDetail?: string;
}

export interface EndpointInfo {
  url: string;
  file: string;
  line: number;
  context: string;
  method: string;
  tag?: string;
  operational?: boolean; // True if URL is used in network call (fetch, axios, etc.)
}

export interface AnalysisResult {
  extensionName: string;
  extensionId: string;
  version: string;
  analysisDate: string;
  
  // Metadata
  publisher: string;
  description: string;
  repository: string;
  homepage: string;
  installCount: string;
  categories: string[];
  activationEvents: string[];
  contributes?: Record<string, unknown>;

  // File inventory
  jsFiles: string[];
  binaryFiles: string[];
  configFiles: string[];
  assetFiles: string[];
  agentConfigFiles: string[];
  fileStats: Record<string, FileStats>;
  fileTypes: FileInfo[];
  totalSize: number;
  
  // Permissions
  permissions: Record<string, unknown>;
  
  // Dependencies
  dependencies: Record<string, string>;
  notableDependencies: Record<string, string>;
  
  // Telemetry
  telemetryConfig: Record<string, unknown>;
  
  // VSIX manifest
  vsixManifest: Record<string, unknown>;
  
  // Endpoints
  endpoints: EndpointInfo[];
  
  // Bundled dependencies detected inside JS bundles
  bundledDependencies: string[];

  // Findings
  findings: Finding[];
  
  // Pattern search results
  patternsSearched: Record<string, string[]>;
  
  // Binary hashes
  binaryHashes: BinaryInfo[];
  
  // LLM-generated
  executiveSummary: string | null;
  verdict: 'CLEAN' | 'SUSPICIOUS' | 'MALICIOUS' | null;

  // Batch analysis info
  totalScanned?: number;
}

export interface LlmAssessment {
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none';
  isFalsePositive: boolean;
  falsePositiveReason: string;
  explanation: string;
  recommendation: 'investigate' | 'likely_benign' | 'dismiss';
  injectionDetected?: boolean;
  // Consensus metadata — present when quorum (3x) was used
  consensus?: {
    votes: Array<{ riskLevel: string; isFalsePositive: boolean; recommendation: string; modelId?: string }>;
    unanimous: boolean;
    splitDecision: boolean; // true if any vote disagreed on riskLevel
  };
}

export interface ScanTask {
  id: string;
  status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  log: string[];
  result: AnalysisResult | null;
  error: string | null;
}

export interface ScanHistoryEntry {
  extensionId: string;
  extensionName: string;
  version: string;
  scanDate: string;
  suspicionScore: number;
  llmAdjustedScore: number | null;
  llmAnalyzed: boolean;
  findingsCount: number;
  truePositives: number;
  reportPath: string;
  breakdown: Record<string, unknown>;
}

// Pattern configuration types
export interface PatternDefinition {
  pattern: string;
  flags?: string;
  description: string;
  risk: 'critical' | 'high' | 'medium' | 'low';
  note?: string;
}

export interface PatternCategory {
  [patternName: string]: PatternDefinition;
}

export interface PatternsConfig {
  version: string;
  // Snake_case keys to match patterns.yaml
  supply_chain?: PatternCategory;
  permission_abuse?: PatternCategory;
  network?: PatternCategory;
  exfiltration?: PatternCategory;
  code_execution?: PatternCategory;
  obfuscation?: PatternCategory;
  ai_agent?: PatternCategory;
  secrets?: PatternCategory;
  telemetry?: PatternCategory;
  credentials?: PatternCategory;
  network_indicators?: PatternCategory;
  prompt_injection?: PatternCategory;
  llm_prompt_surface?: PatternCategory;
  malicious_agent_instructions?: PatternCategory;
  path_traversal?: PatternCategory;
  resource_exhaustion?: PatternCategory;
  backdoor_indicators?: PatternCategory;
  endpoint_filtering?: Record<string, unknown>;
}

// Max evidence characters passed to the LLM per assessment mode.
export interface EvidenceMaxChars {
  strategic: number;   // strategic bulk prompt (default 600)
  triage: number;      // triage batch prompt (default 1500)
  bulk: number;        // bulk-mode prompt (default 800)
  individual: number;  // single-finding / consensus prompt (default 1500)
}

// Pipeline-level LLM tuning knobs (not per-model). Previously hardcoded.
export interface LlmTuning {
  tierABatchSize: number;   // findings per high-risk (tier A) triage batch (default 5)
  consensusVotes: number;   // total votes per high/critical finding in consensus (default 3)
  evidenceMaxChars: EvidenceMaxChars;
}

// LLM Configuration
export interface LlmConfig {
  model: string;
  baseUrl: string;
  provider: 'ollama' | 'openai';
  timeout: number;
  maxTokens: number;
  temperature: number;
  concurrency: number;
  assessmentMode: 'strategic' | 'bulk';
  stream?: boolean; // Enable streaming for large responses
  apiKey?: string; // Optional API key for OpenAI-compatible endpoints
  batchSize?: number; // Max findings per triage batch (default: 20)
  llmTuning?: LlmTuning; // Pipeline tuning knobs (from AppConfig)
}

// Multi-model configuration for consensus
export interface ModelSlotConfig {
  id: string;               // 'main' | 'judge1' | 'judge2'
  label: string;
  enabled: boolean;
  provider: 'ollama' | 'openai';
  model: string;
  baseUrl: string;
  apiKey?: string;
  timeout: number;
  maxTokens: number;
  temperature: number;
  batchSize?: number;       // Max findings per triage batch (default: 20)
  contextWindow?: number;   // Operator override for the model's context window; auto-detected when unset
  promptProfile?: string;   // Deprecated — use AppConfig.promptProfile instead
}

export interface ConsensusConfig {
  // Cross-model consensus votes are always recorded for every finding the
  // judges assessed. This flag governs whether the judges' majority may
  // OVERRIDE the main model's risk: false (default) = only on high/critical
  // findings (main keeps the call on medium/low, but dissenting votes are still
  // recorded); true = majority merge wins everywhere.
  judgesValidateAllFindings: boolean;
}

// Tunable scoring weights (previously hardcoded in scoring.ts). Risk-label
// text/colors stay fixed; only the numeric knobs are exposed.
export interface ScoringConfig {
  riskWeights: { critical: number; high: number; medium: number; low: number };
  injectionBoost: number;   // added to a finding's weight when injection detected (default 5)
  // Weight multiplier (0..1) for LLM-adjusted scores on findings the triage
  // recommended 'likely_benign' — the counterpart to the 1.5x 'investigate'
  // boost, so post-triage scores reflect triage belief (default 0.5).
  likelyBenignFactor: number;
  binaryBoost: number;      // added once when the extension ships binaries (default 5)
  verdictBoost: { malicious: number; suspicious: number }; // LLM verdict score bumps (25 / 5)
  // Score thresholds for the Very Suspicious / Suspicious / Moderate labels
  // (below `moderate` is "Low Risk"). Defaults: 50 / 30 / 15.
  thresholds: { verySuspicious: number; suspicious: number; moderate: number };
}

// Analysis-pipeline size limits (previously hardcoded in llm.ts / static.ts).
export interface AnalysisLimits {
  maxFindingsForSummary: number;  // findings included in the exec summary (default 100)
  maxEvidenceChars: number;       // chars of code captured per finding at scan time (default 4000)
  execSummaryChunkChars: number;  // source bytes per exec-summary chunk (default 50000)
  zeroHitSampleLimit: number;     // JS files sampled when there are no findings (default 6)
  zeroHitBytesBudget: number;     // byte budget for that zero-hit sampling (default 60000)
}

/** Automatic marketplace sweep + high-risk alerting. See AutoScanConfigSchema. */
export interface AutoScanConfig {
  enabled: boolean;
  intervalMinutes: number;
  count: number;
  alertMinScore: number;
  /** Only alert at/under this install count (malware is near-zero installs). */
  alertMaxInstalls: number;
}

export interface AppConfig {
  version: string;
  main: ModelSlotConfig;
  judges: ModelSlotConfig[];
  consensus: ConsensusConfig;
  assessmentMode: 'strategic' | 'bulk';
  promptProfile: string;    // Global prompt profile — applies to all models uniformly
  concurrency: number;
  llmTuning: LlmTuning;
  scoring: ScoringConfig;
  analysisLimits: AnalysisLimits;
  autoScan: AutoScanConfig;
  defaultNoLlm: boolean;
  defaultFull: boolean;
}

// Server configuration
export interface ServerConfig {
  port: number;
  host: string;
  reportsDir: string;
  patternsFile: string;
  historyFile: string;
  llm: LlmConfig;
  /** Global HTTP rate limit applied to every route (per client IP). */
  rateLimit: RateLimitConfig;
  defaultNoLlm?: boolean;
  defaultFull?: boolean;
}

export interface RateLimitConfig {
  /** Max requests allowed per client within `timeWindowMs`. */
  max: number;
  /** Rolling window length in milliseconds. */
  timeWindowMs: number;
}
