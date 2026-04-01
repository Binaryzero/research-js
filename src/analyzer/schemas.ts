/**
 * Zod schemas for structured LLM output
 * Replaces manual JSON parsing with type-safe validation
 */
import { z } from 'zod';

/**
 * Single finding assessment schema
 * Used for individual finding assessment and consensus voting
 */
export const AssessmentSchema = z.object({
  risk_level: z.enum(['critical', 'high', 'medium', 'low', 'none']),
  is_false_positive: z.boolean(),
  false_positive_reason: z.string().default(''),
  explanation: z.string(),
  recommendation: z.enum(['investigate', 'likely_benign', 'dismiss']),
  injection_detected: z.boolean().default(false),
});

/**
 * Batch assessment schema for multiple findings
 * Used in bulk assessment mode
 */
export const BatchAssessmentSchema = z.array(AssessmentSchema);

/**
 * Assessment with index for triage batch processing
 * Tracks position in the findings array
 */
export const IndexedAssessmentSchema = AssessmentSchema.extend({
  index: z.number(),
});

/**
 * Array of indexed assessments for triage batch
 */
export const IndexedBatchAssessmentSchema = z.array(IndexedAssessmentSchema);

// Type exports
export type AssessmentOutput = z.infer<typeof AssessmentSchema>;
export type BatchAssessmentOutput = z.infer<typeof BatchAssessmentSchema>;
export type IndexedAssessmentOutput = z.infer<typeof IndexedAssessmentSchema>;
export type IndexedBatchAssessmentOutput = z.infer<typeof IndexedBatchAssessmentSchema>;
