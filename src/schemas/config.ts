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
  defaultNoLlm: z.boolean(),
  defaultFull: z.boolean(),
});

// Type exports (mirrors from types/index.ts)
export type ModelSlotConfig = z.infer<typeof ModelSlotSchema>;
export type ConsensusConfig = z.infer<typeof ConsensusConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
