/**
 * OpenAIProvider — LLM provider for OpenAI-compatible endpoints.
 * Uses the AI SDK with @ai-sdk/openai for reliable HTTP handling.
 * Supports vLLM, LM Studio, llama.cpp server, and any OpenAI-compatible API.
 */
import { generateText, generateObject as aiGenerateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { ZodSchema } from 'zod';
import type { LlmProvider } from './llm-provider.js';
import type { ProviderConnection, ProviderInference, ProviderIdentity } from './types.js';

export class OpenAIProvider implements LlmProvider {
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

  async isAvailable(): Promise<boolean> {
    try {
      // Check /v1/models directly with fetch
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.connection.baseUrl}/v1/models`, {
        headers: this.connection.apiKey ? { 'Authorization': `Bearer ${this.connection.apiKey}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, system?: string): Promise<string> {
    const client = createOpenAI({
      baseURL: `${this.connection.baseUrl}/v1`,
      apiKey: this.connection.apiKey || 'ollama',
    });

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
    const client = createOpenAI({
      baseURL: `${this.connection.baseUrl}/v1`,
      apiKey: this.connection.apiKey || 'ollama',
    });

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

export default OpenAIProvider;
