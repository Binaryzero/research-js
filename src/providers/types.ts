/**
 * Shared types for LLM provider configuration.
 */

/** Provider type discriminator - determines which provider implementation to use */
export type ProviderType = 'ollama' | 'openai';

export interface ProviderIdentity { id: string; model: string }

export interface ProviderConnection {
  baseUrl: string;
  timeout: number;
  stream?: boolean; // Enable streaming for large responses
  apiKey?: string; // Optional API key for OpenAI-compatible endpoints
}

export interface ProviderInference { maxTokens: number; temperature: number; maxRetries?: number }
