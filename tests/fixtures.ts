/**
 * Shared factory functions for test fixtures.
 * Every factory produces a valid object with sensible defaults;
 * callers override only the fields they care about.
 */

import type {
  Finding,
  AnalysisResult,
  LlmAssessment,
  LlmConfig,
  AppConfig,
  ModelSlotConfig,
} from '../src/types/index.js';
import type { PromptConfig } from '../src/config.js';

export function makeFinding(overrides?: Partial<Finding>): Finding {
  return {
    category: 'network',
    title: 'Test Pattern',
    location: 'src/main.js:10',
    observation: 'Test observation',
    evidence: 'fetch("https://api.example.com")',
    lineStart: 10,
    lineEnd: 10,
    context: '',
    isFalsePositive: false,
    falsePositiveReason: '',
    riskLevel: 'medium',
    ...overrides,
  };
}

export function makeLlmAssessment(overrides?: Partial<LlmAssessment>): LlmAssessment {
  return {
    riskLevel: 'medium',
    isFalsePositive: false,
    falsePositiveReason: '',
    explanation: 'Assessment explanation.',
    recommendation: 'investigate',
    ...overrides,
  };
}

export function makeAnalysisResult(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    extensionName: 'test-extension',
    extensionId: 'publisher.test-extension',
    version: '1.0.0',
    analysisDate: '2026-01-01T00:00:00Z',
    publisher: 'publisher',
    description: 'A test extension',
    repository: '',
    homepage: '',
    installCount: '1000',
    categories: [],
    activationEvents: [],
    jsFiles: [],
    binaryFiles: [],
    configFiles: [],
    assetFiles: [],
    agentConfigFiles: [],
    fileStats: {},
    fileTypes: [],
    totalSize: 0,
    permissions: {},
    dependencies: {},
    notableDependencies: {},
    telemetryConfig: {},
    vsixManifest: {},
    endpoints: [],
    bundledDependencies: [],
    findings: [],
    patternsSearched: {},
    binaryHashes: [],
    executiveSummary: null,
    verdict: null,
    ...overrides,
  };
}

export function makeLlmConfig(overrides?: Partial<LlmConfig>): LlmConfig {
  return {
    model: 'test-model',
    baseUrl: 'http://localhost:11434',
    provider: 'ollama',
    timeout: 30000,
    maxTokens: 4096,
    temperature: 0.3,
    concurrency: 2,
    assessmentMode: 'strategic',
    ...overrides,
  };
}

export function makeModelSlot(overrides?: Partial<ModelSlotConfig>): ModelSlotConfig {
  return {
    id: 'main',
    label: 'Main Model',
    enabled: true,
    provider: 'ollama',
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434',
    timeout: 180000,
    maxTokens: 32000,
    temperature: 0.3,
    ...overrides,
  };
}

export function makeAppConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    version: '1',
    main: makeModelSlot(),
    judges: [],
    consensus: { judgesValidateAllFindings: false },
    assessmentMode: 'strategic',
    promptProfile: 'default',
    concurrency: 10,
    llmTuning: {
      tierABatchSize: 5,
      consensusVotes: 3,
      evidenceMaxChars: { strategic: 600, triage: 1500, bulk: 800, individual: 1500 },
    },
    scoring: {
      riskWeights: { critical: 10, high: 5, medium: 2, low: 1 },
      injectionBoost: 5,
      binaryBoost: 5,
      verdictBoost: { malicious: 25, suspicious: 5 },
      thresholds: { verySuspicious: 50, suspicious: 30, moderate: 15 },
    },
    defaultNoLlm: false,
    defaultFull: false,
    ...overrides,
  };
}

export function makePromptConfig(overrides?: Partial<PromptConfig>): PromptConfig {
  return {
    version: '1.0',
    finding_assessment: {
      system: 'You are a security analyst.',
      user: 'Assess this finding: {category} {title} {location} {evidence}',
      common_false_positives: 'License text, test files',
      genuine_concerns: 'Data exfiltration, code injection',
    },
    executive_summary: {
      system: 'You are a security analyst writing summaries.',
      user: 'Write a summary for this analysis.',
    },
    finding_prose: {
      system: 'You are a technical writer.',
      user: 'Write a finding description.',
    },
    ...overrides,
  };
}
