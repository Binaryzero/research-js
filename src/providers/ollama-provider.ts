/**
 * OllamaProvider — LLM provider for native Ollama endpoints.
 *
 * Uses @ai-sdk/openai pointed at Ollama's OpenAI-compatible API (/v1).
 * ollama-ai-provider is not used here because it hardcodes specificationVersion: 'v1',
 * which the ai SDK v6 rejects before making any network call.
 * @ai-sdk/openai returns specificationVersion 'v3' which satisfies the 'v2' minimum.
 */
import { generateText, generateObject as aiGenerateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { ZodSchema } from 'zod';
import type { LlmProvider } from './llm-provider.js';
import type { ProviderConnection, ProviderInference, ProviderIdentity } from './types.js';

export class OllamaProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly infer: Readonly<ProviderInference>;
  private readonly connection: ProviderConnection;

  constructor(identity: ProviderIdentity, connection: ProviderConnection, inference: ProviderInference) {
    this.id = identity.id;
    this.model = identity.model;
    this.infer = inference;
    this.connection = connection;
  }

  private createClient() {
    return createOpenAI({
      baseURL: `${this.connection.baseUrl}/v1`,
      apiKey: this.connection.apiKey || 'ollama',
      // No compatibility flag needed — @ai-sdk/openai v3 returns specificationVersion 'v3'
      // regardless, which satisfies the ai SDK v6 requirement of 'v2' minimum.
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.connection.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, system?: string): Promise<string> {
    const client = this.createClient();
    const { text } = await generateText({
      model: client(this.model),
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: prompt },
      ],
      maxOutputTokens: this.infer.maxTokens,
      temperature: this.infer.temperature,
      abortSignal: AbortSignal.timeout(this.connection.timeout),
    });
    return text ?? '';
  }

  async generateObject<T>(schema: ZodSchema<T>, prompt: string, system?: string): Promise<T> {
    const client = this.createClient();
    const { object } = await aiGenerateObject({
      model: client(this.model),
      schema,
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: prompt },
      ],
      maxOutputTokens: this.infer.maxTokens,
      temperature: this.infer.temperature,
      abortSignal: AbortSignal.timeout(this.connection.timeout),
    });
    return object;
  }
}

export default OllamaProvider;
