/**
 * OllamaProvider — LLM provider for native Ollama endpoints.
 * Uses the AI SDK with ollama-ai-provider for reliable HTTP handling.
 */
import { generateText, generateObject as aiGenerateObject } from 'ai';
import { createOllama } from 'ollama-ai-provider';
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

  async isAvailable(): Promise<boolean> {
    try {
      // Check /api/tags directly since ollama-ai-provider doesn't expose list()
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.connection.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, system?: string): Promise<string> {
    const client = createOllama({ baseURL: this.connection.baseUrl });

    try {
      const { text } = await generateText({
        model: client(this.model) as any,
        messages: [
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          { role: 'user' as const, content: prompt },
        ],
        maxOutputTokens: this.infer.maxTokens,
        temperature: this.infer.temperature,
        abortSignal: AbortSignal.timeout(this.connection.timeout),
      });
      return text ?? '';
    } catch (error: any) {
      // Handle AI SDK v5/v6 model version incompatibility
      if (error?.message?.includes('Unsupported model version')) {
        throw new Error(
          `Model "${this.model}" uses an unsupported specification version. ` +
          'This model may not be compatible with AI SDK v6. ' +
          'Try using a different model or provider.'
        );
      }
      throw error;
    }
  }

  async generateObject<T>(schema: ZodSchema<T>, prompt: string, system?: string): Promise<T> {
    const client = createOllama({ baseURL: this.connection.baseUrl });

    try {
      const { object } = await aiGenerateObject({
        model: client(this.model) as any,
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
    } catch (error: any) {
      // Handle AI SDK v5/v6 model version incompatibility
      if (error?.message?.includes('Unsupported model version')) {
        throw new Error(
          `Model "${this.model}" uses an unsupported specification version. ` +
          'This model may not be compatible with AI SDK v6. ' +
          'Try using a different model or provider.'
        );
      }
      throw error;
    }
  }
}

export default OllamaProvider;
