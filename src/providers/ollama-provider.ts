/**
 * OllamaProvider — LLM provider for Ollama and OpenAI-compatible endpoints.
 * Extracted from LlmClient HTTP transport logic.
 */
import { Pool } from 'undici';
import type { LlmProvider } from './llm-provider.js';
import type { ResolvedStyle, ProviderConnection, ProviderInference, ProviderIdentity } from './types.js';

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

// Module-level connection pool cache for connection reuse
const _pools = new Map<string, Pool>();

function getPool(baseUrl: string): Pool {
  if (!_pools.has(baseUrl)) {
    _pools.set(baseUrl, new Pool(baseUrl, { connections: 10 }));
  }
  return _pools.get(baseUrl)!;
}

// Module-level API style cache - detected once per baseUrl per process lifetime
const _styleCache = new Map<string, ResolvedStyle>();

export class OllamaProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private readonly conn: Readonly<ProviderConnection>;
  private readonly infer: Readonly<ProviderInference>;

  constructor(identity: ProviderIdentity, connection: ProviderConnection, inference: ProviderInference) {
    this.id = identity.id;
    this.model = identity.model;
    this.conn = connection;
    this.infer = inference;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const pool = getPool(this.conn.baseUrl);
      const { statusCode, body: resBody } = await pool.request({
        path: '/',
        method: 'GET',
        headers: {},
        bodyTimeout: this.conn.timeout,
        headersTimeout: 10_000,
      });
      // Validate response by parsing JSON (discard result)
      await resBody.json() as Record<string, unknown>;
      return statusCode >= 200 && statusCode < 300;
    } catch {
      return false;
    }
  }

  async detectApiStyle(): Promise<ResolvedStyle> {
    // Check module-level cache first
    const cacheKey = `${this.conn.baseUrl}::${this.conn.apiStyle}`;
    const cached = _styleCache.get(cacheKey);
    if (cached !== undefined) return cached;
    
    if (this.conn.apiStyle !== 'auto') {
      _styleCache.set(cacheKey, this.conn.apiStyle);
      return this.conn.apiStyle;
    }
    const probeStyles: ResolvedStyle[] = ['openai', 'chat', 'generate'];
    for (const style of probeStyles) {
      try {
        const body = this.probeBody(style);
        const url = endpointFor(this.conn.baseUrl, style);
        const pool = getPool(this.conn.baseUrl);
        const { statusCode, body: resBody } = await pool.request({
          path: new URL(url).pathname + new URL(url).search,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          bodyTimeout: this.conn.timeout,
          headersTimeout: 10_000,
        });
        if (statusCode >= 400) {
          const text = await resBody.text().catch(() => '');
          console.error(`[LLM:${this.id}] Probe ${style} failed: HTTP ${statusCode}${text ? ' — ' + text.slice(0, 200) : ''}`);
          continue;
        }
        // Validate response by parsing JSON (discard result)
        await resBody.json() as Record<string, unknown>;
        _styleCache.set(cacheKey, style);
        return style;
      } catch { /* try next */ }
    }
    _styleCache.set(cacheKey, 'generate');
    return 'generate';
  }

  async generate(prompt: string, system?: string, retries = 2): Promise<string> {
    const style = await this.detectApiStyle();
    const url = endpointFor(this.conn.baseUrl, style);
    const body = this.requestBody(style, prompt, system);
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const pool = getPool(this.conn.baseUrl);
        const { statusCode, body: resBody } = await pool.request({
          path: new URL(url).pathname + new URL(url).search,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          bodyTimeout: this.conn.timeout,
          headersTimeout: 10_000,
        });
        if (statusCode >= 400) {
          const text = await resBody.text().catch(() => '');
          console.error(`[LLM:${this.id}] HTTP ${statusCode} (${prompt.length} chars)${text ? ' — ' + text.slice(0, 200) : ''}`);
          
          // Retry on 5xx errors and 429 (rate limit)
          if (statusCode >= 500 || statusCode === 429) {
            if (attempt < retries) {
              // Longer delay for 429 to give Ollama time to recover
              const baseDelay = statusCode === 429 ? 2000 : 1000;
              const delayMs = baseDelay * Math.pow(2, attempt); // 2s, 4s, 8s for 429; 1s, 2s, 4s for 5xx
              console.log(`[LLM:${this.id}] Retry ${attempt + 1}/${retries} after ${delayMs}ms (status: ${statusCode})`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
              continue;
            }
          }
          return '';
        }
        
        return extractContent(style, await resBody.json() as Record<string, unknown>);
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
