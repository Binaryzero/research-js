/**
 * Shared types for LLM provider configuration.
 */
export type ApiStyle = 'openai' | 'chat' | 'generate' | 'auto';
export type ResolvedStyle = 'openai' | 'chat' | 'generate';

export interface ProviderIdentity { id: string; model: string }

export interface ProviderConnection { baseUrl: string; apiStyle: ApiStyle; timeout: number }

export interface ProviderInference { maxTokens: number; temperature: number }
