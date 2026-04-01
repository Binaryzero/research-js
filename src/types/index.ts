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
  promptProfile?: string;   // Deprecated — use AppConfig.promptProfile instead
}

export interface ConsensusConfig {
  judgesValidateAllFindings: boolean;  // false = HIGH/CRITICAL only (default)
}

export interface AppConfig {
  version: string;
  main: ModelSlotConfig;
  judges: ModelSlotConfig[];
  consensus: ConsensusConfig;
  assessmentMode: 'strategic' | 'bulk';
  promptProfile: string;    // Global prompt profile — applies to all models uniformly
  concurrency: number;
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
  defaultNoLlm?: boolean;
  defaultFull?: boolean;
}
