/**
 * Provider factory for creating LLM provider instances.
 * Maps provider type discriminator to concrete implementations.
 */
import type { LlmProvider } from './llm-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import type { ProviderType, ProviderIdentity, ProviderConnection, ProviderInference } from './types.js';

export function createProvider(
  type: ProviderType,
  identity: ProviderIdentity,
  connection: ProviderConnection,
  inference: ProviderInference
): LlmProvider {
  switch (type) {
    case 'ollama':
      return new OllamaProvider(identity, connection, inference);
    case 'openai':
      return new OpenAIProvider(identity, connection, inference);
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

export { OllamaProvider, OpenAIProvider };
export type { LlmProvider };
export * from './types.js';
