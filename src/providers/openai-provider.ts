/**
 * OpenAIProvider — LLM provider for OpenAI-compatible endpoints.
 * Uses the official 'openai' npm package for reliable HTTP handling.
 * Supports vLLM, LM Studio, llama.cpp server, and any OpenAI-compatible API.
 */
import OpenAI from 'openai';
import type { LlmProvider } from './llm-provider.js';
import type { ProviderConnection, ProviderInference, ProviderIdentity } from './types.js';

export class OpenAIProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly infer: Readonly<ProviderInference>;
  private readonly client: OpenAI;

  constructor(identity: ProviderIdentity, connection: ProviderConnection, inference: ProviderInference) {
    this.id = identity.id;
    this.model = identity.model;
    this.infer = inference;
    this.client = new OpenAI({
      baseURL: `${connection.baseUrl}/v1`,
      apiKey: connection.apiKey || 'ollama', // OpenAI-compat servers often ignore the key
      timeout: connection.timeout,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, system?: string): Promise<string> {
    const messages = [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      { role: 'user' as const, content: prompt },
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: this.infer.maxTokens,
      temperature: this.infer.temperature,
    });

    return response.choices[0]?.message?.content ?? '';
  }
}

export default OpenAIProvider;
