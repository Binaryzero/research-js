/**
 * Zod schemas for structured LLM output
 * Replaces manual JSON parsing with type-safe validation
 */
import { z } from 'zod';
import type { LlmAssessment } from '../types/index.js';

export const AssessmentSchema = z.object({
  risk_level: z.enum(['critical', 'high', 'medium', 'low', 'none']),
  is_false_positive: z.boolean(),
  false_positive_reason: z.string().default(''),
  explanation: z.string(),
  recommendation: z.enum(['investigate', 'likely_benign', 'dismiss']),
  injection_detected: z.boolean().default(false),
});

export const BatchAssessmentSchema = z.array(AssessmentSchema);

export const IndexedAssessmentSchema = AssessmentSchema.extend({
  index: z.number(),
});

export const IndexedBatchAssessmentSchema = z.array(IndexedAssessmentSchema);

/**
 * Maps validated snake_case wire format to the internal camelCase LlmAssessment shape.
 * Centralizes the renaming so parse sites get the consumer-ready type directly.
 */
export const LlmAssessmentSchema = AssessmentSchema.transform((parsed): LlmAssessment => ({
  riskLevel: parsed.risk_level,
  isFalsePositive: parsed.is_false_positive,
  falsePositiveReason: parsed.false_positive_reason,
  explanation: parsed.explanation,
  recommendation: parsed.recommendation,
  injectionDetected: parsed.injection_detected,
}));

export const IndexedLlmAssessmentSchema = IndexedAssessmentSchema.transform(
  (parsed): LlmAssessment & { index: number } => ({
    index: parsed.index,
    riskLevel: parsed.risk_level,
    isFalsePositive: parsed.is_false_positive,
    falsePositiveReason: parsed.false_positive_reason,
    explanation: parsed.explanation,
    recommendation: parsed.recommendation,
    injectionDetected: parsed.injection_detected,
  })
);

export type AssessmentOutput = z.infer<typeof AssessmentSchema>;
export type BatchAssessmentOutput = z.infer<typeof BatchAssessmentSchema>;
export type IndexedAssessmentOutput = z.infer<typeof IndexedAssessmentSchema>;
export type IndexedBatchAssessmentOutput = z.infer<typeof IndexedBatchAssessmentSchema>;
