/**
 * OllamaProvider — LLM provider for Ollama and OpenAI-compatible endpoints.
 * Extracted from LlmClient HTTP transport logic.
 */
import type { LlmProvider } from './llm-provider.js';
import type { ResolvedStyle, ProviderIdentity, ProviderConnection, ProviderInference } from './types.js';
// -- Module-level helpers -----------------------------------------------
function endpointFor(base: string, style: ResolvedStyle): string {
  switch (style) {
    case 'openai': return `${base}/v1/chat/completions`;
    case 'chat': return `${base}/api/chat`;
    case 'generate': return `${base}/api/generate`;
  }
}

function buildMessages(prompt: string, system?: string): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [];
  if (system) result.push({ role: 'system', content: system });
  result.push({ role: 'user', content: prompt });
  return result;
}

function extractContent(style: ResolvedStyle, data: Record<string, unknown>): string {
  if (style === 'openai') {
    const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content ?? '';
  }
  if (style === 'chat') {
    return (data.message as { content?: string } | undefined)?.content ?? '';
  }
  return (data.response as string) ?? '';
}

export class OllamaProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly conn: Readonly<ProviderConnection>;
  private readonly infer: Readonly<ProviderInference>;
  private cachedStyle: ResolvedStyle | undefined;

  constructor(identity: ProviderIdentity, connection: ProviderConnection, inference: ProviderInference) {
    this.id = identity.id;
    this.model = identity.model;
    this.conn = connection;
    this.infer = inference;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(this.conn.baseUrl, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async detectApiStyle(): Promise<ResolvedStyle> {
    if (this.cachedStyle) return this.cachedStyle;
    if (this.conn.apiStyle !== 'auto') {
      this.cachedStyle = this.conn.apiStyle;
      return this.cachedStyle;
    }
    const probeStyles: ResolvedStyle[] = ['openai', 'chat', 'generate'];
    for (const style of probeStyles) {
      try {
        const body = this.probeBody(style);
        const url = endpointFor(this.conn.baseUrl, style);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) { this.cachedStyle = style; return style; }
      } catch { /* try next */ }
    }
    return 'generate';
  }

  async generate(prompt: string, system?: string): Promise<string> {
    const style = await this.detectApiStyle();
    const url = endpointFor(this.conn.baseUrl, style);
    const body = this.requestBody(style, prompt, system);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.conn.timeout),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[LLM:${this.id}] HTTP ${res.status} (${prompt.length} chars)${text ? ' — ' + text.slice(0, 200) : ''}`);
        return '';
      }
      return extractContent(style, await res.json() as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[LLM:${this.id}] error (${prompt.length} chars): ${msg}`);
      return '';
    }
  }

  private probeBody(style: ResolvedStyle): string {
    if (style === 'generate') {
      return JSON.stringify({ model: this.model, prompt: 'hi', stream: false, max_tokens: 5 });
    }
    return JSON.stringify({ model: this.model, messages: [{ role: 'user', content: 'hi' }], stream: false, max_tokens: 5 });
  }

  private requestBody(style: ResolvedStyle, prompt: string, system?: string): string {
    const messages = buildMessages(prompt, system);
    if (style === 'openai') {
      return JSON.stringify({ model: this.model, messages, temperature: this.infer.temperature, max_tokens: this.infer.maxTokens, stream: false });
    }
    if (style === 'chat') {
      return JSON.stringify({ model: this.model, messages, stream: false, options: { temperature: this.infer.temperature, num_predict: this.infer.maxTokens } });
    }
    const fullPrompt = system ? system + '\n\n' + prompt : prompt;
    return JSON.stringify({ model: this.model, prompt: fullPrompt, stream: false, options: { temperature: this.infer.temperature, num_predict: this.infer.maxTokens } });
  }
}

export default OllamaProvider;
