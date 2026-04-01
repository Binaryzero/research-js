/**
 * Abstract LLM provider interface.
 * Implementations handle the HTTP transport to specific LLM APIs.
 */
import type { ZodSchema } from 'zod';

export interface LlmProvider {
  /** Identifier for this provider instance: 'main', 'judge1', 'judge2' */
  readonly id: string;
  /** Model name being used */
  readonly model: string;
  /** Check if the LLM endpoint is reachable */
  isAvailable(): Promise<boolean>;
  /** Generate a completion. Returns empty string on failure. */
  generate(prompt: string, system?: string): Promise<string>;
  /** Generate structured output matching a Zod schema. */
  generateObject<T>(schema: ZodSchema<T>, prompt: string, system?: string): Promise<T>;
}
