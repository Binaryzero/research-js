/**
 * OllamaProvider — LLM provider for Ollama and OpenAI-compatible endpoints.
 * Extracted from LlmClient HTTP transport logic.
 */
import { Agent } from 'http';
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
  private readonly agent: Agent;

  constructor(identity: ProviderIdentity, connection: ProviderConnection, inference: ProviderInference) {
    this.id = identity.id;
    this.model = identity.model;
    this.conn = connection;
    this.infer = inference;
    // HTTP connection pooling for connection reuse
    this.agent = new Agent({ keepAlive: true, maxSockets: 10 });
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

  async generate(prompt: string, system?: string, retries = 2): Promise<string> {
    const style = await this.detectApiStyle();
    const url = endpointFor(this.conn.baseUrl, style);
    const body = this.requestBody(style, prompt, system);
    
    // Use streaming for bulk mode to improve time-to-first-result
    const useStreaming = this.conn.stream && style === 'openai';
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Connection': 'keep-alive' },
          body,
          signal: AbortSignal.timeout(this.conn.timeout),
          // @ts-ignore - Node 18+ fetch supports agent option
          agent: this.agent,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.error(`[LLM:${this.id}] HTTP ${res.status} (${prompt.length} chars)${text ? ' — ' + text.slice(0, 200) : ''}`);
          
          // Retry on 5xx errors and 429 (rate limit)
          if (res.status >= 500 || res.status === 429) {
            if (attempt < retries) {
              // Longer delay for 429 to give Ollama time to recover
              const baseDelay = res.status === 429 ? 2000 : 1000;
              const delayMs = baseDelay * Math.pow(2, attempt); // 2s, 4s, 8s for 429; 1s, 2s, 4s for 5xx
              console.log(`[LLM:${this.id}] Retry ${attempt + 1}/${retries} after ${delayMs}ms (status: ${res.status})`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
              continue;
            }
          }
          return '';
        }
        
        // Handle streaming response
        if (useStreaming && res.body) {
          return await this.handleStreamingResponse(res);
        }
        
        return extractContent(style, await res.json() as Record<string, unknown>);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[LLM:${this.id}] error (${prompt.length} chars): ${msg}`);
        
        // Retry on network errors and timeouts (including 429 from previous attempt)
        if (attempt < retries && (msg.includes('timeout') || msg.includes('fetch failed'))) {
          // Longer delay for 429 to give Ollama time to recover
          const baseDelay = 2000; // Start with 2s for 429
          const delayMs = baseDelay * Math.pow(2, attempt); // 2s, 4s, 8s
          console.log(`[LLM:${this.id}] Retry ${attempt + 1}/${retries} after ${delayMs}ms (network error)`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        return '';
      }
    }
    return '';
  }

  /**
   * Handle streaming response for OpenAI-compatible endpoints.
   * Accumulates chunks and returns the complete response.
   */
  private async handleStreamingResponse(res: Response): Promise<string> {
    const chunks: string[] = [];
    const reader = res.body?.getReader();
    if (!reader) {
      return extractContent('openai', await res.json() as Record<string, unknown>);
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';
              chunks.push(content);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } finally {
      reader.cancel();
    }

    return chunks.join('');
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
