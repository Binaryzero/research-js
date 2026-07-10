/**
 * Zod schemas for configuration validation
 * Provides type-safe validation for config.json
 */
import { z } from 'zod';

/**
 * Model slot configuration schema
 * Represents a single LLM model configuration (main or judge)
 */
export const ModelSlotSchema = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  provider: z.enum(['ollama', 'openai']),
  model: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  timeout: z.number().min(1000),
  maxTokens: z.number().min(100),
  temperature: z.number().min(0).max(2),
  batchSize: z.number().min(1).max(50).optional(),
});

/**
 * Consensus configuration schema
 */
export const ConsensusConfigSchema = z.object({
  judgesValidateAllFindings: z.boolean(),
});

/**
 * Per-mode evidence length limits (characters of finding code sent to the LLM).
 * Each field defaults to its historical hardcoded value so behavior is preserved.
 */
export const EvidenceMaxCharsSchema = z.object({
  strategic: z.number().min(100).max(200000).default(600),
  triage: z.number().min(100).max(200000).default(1500),
  bulk: z.number().min(100).max(200000).default(800),
  individual: z.number().min(100).max(200000).default(1500),
});

/**
 * Pipeline-level LLM tuning knobs (previously hardcoded in the analyzer).
 */
export const LlmTuningSchema = z.object({
  tierABatchSize: z.number().min(1).max(50).default(5),
  consensusVotes: z.number().min(1).max(9).default(3),
  evidenceMaxChars: EvidenceMaxCharsSchema.default({}),
});

/**
 * Tunable scoring weights (previously hardcoded in scoring.ts). Each field
 * defaults to its historical value so scoring is unchanged out of the box.
 */
export const ScoringConfigSchema = z.object({
  riskWeights: z.object({
    critical: z.number().min(0).max(1000).default(10),
    high: z.number().min(0).max(1000).default(5),
    medium: z.number().min(0).max(1000).default(2),
    low: z.number().min(0).max(1000).default(1),
  }).default({}),
  injectionBoost: z.number().min(0).max(1000).default(5),
  binaryBoost: z.number().min(0).max(1000).default(5),
  verdictBoost: z.object({
    malicious: z.number().min(0).max(1000).default(25),
    suspicious: z.number().min(0).max(1000).default(5),
  }).default({}),
  thresholds: z.object({
    verySuspicious: z.number().min(1).max(10000).default(50),
    suspicious: z.number().min(1).max(10000).default(30),
    moderate: z.number().min(1).max(10000).default(15),
  }).default({}),
});

/**
 * Full application configuration schema
 */
export const AppConfigSchema = z.object({
  version: z.string(),
  main: ModelSlotSchema,
  judges: z.array(ModelSlotSchema),
  consensus: ConsensusConfigSchema,
  assessmentMode: z.enum(['strategic', 'bulk']),
  promptProfile: z.string(),
  concurrency: z.number().min(1).max(50),
  llmTuning: LlmTuningSchema.default({}),
  scoring: ScoringConfigSchema.default({}),
  defaultNoLlm: z.boolean(),
  defaultFull: z.boolean(),
});

// Type exports (mirrors from types/index.ts)
export type ModelSlotConfig = z.infer<typeof ModelSlotSchema>;
export type ConsensusConfig = z.infer<typeof ConsensusConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
