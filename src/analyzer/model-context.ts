/**
 * Model context-window detection.
 *
 * The app used to assume a flat maxTokens for every model, which is wrong: a
 * modern model's real context window (e.g. llama3.2 = 131072, glm5.2 = 1000000)
 * dwarfs the old 32k default. This module resolves the ACTUAL context window per
 * model so limits/sizing reflect what each backend can really handle.
 *
 * Resolution order (first hit wins):
 *   1. explicit override (operator-set on the model slot)
 *   2. live provider probe  (Ollama /api/show, OpenAI-compatible /v1/models)
 *   3. static lookup table  (well-known hosted models the probe can't report)
 *   4. unknown (null)
 *
 * Callers must pass a base URL that has already been validated (SSRF guard); this
 * module performs raw fetches against it.
 */
import type { ProviderType } from '../providers/types.js';

export type ContextWindowSource = 'override' | 'probe' | 'lookup' | 'unknown';

export interface ContextWindowResult {
  contextWindow: number | null;
  source: ContextWindowSource;
}

export interface ResolveContextInput {
  provider: ProviderType;
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Operator override; wins over everything when a positive integer. */
  override?: number;
  /** Probe timeout in ms (default 6000). */
  timeoutMs?: number;
}

const DEFAULT_PROBE_TIMEOUT_MS = 6000;

/**
 * Curated fallback for well-known hosted models whose APIs don't report a
 * context length. Ordered MOST-SPECIFIC FIRST — the first substring match
 * (case-insensitive) against the model name wins, so `llama3.2` must precede the
 * broader `llama3`. A live probe always takes precedence over this table.
 */
const KNOWN_CONTEXT_WINDOWS: ReadonlyArray<readonly [string, number]> = [
  // OpenAI
  ['gpt-4.1', 1_047_576],
  ['gpt-4o', 128_000],
  ['gpt-4-turbo', 128_000],
  ['gpt-4-32k', 32_768],
  ['gpt-4', 8_192],
  ['gpt-3.5-turbo-16k', 16_385],
  ['gpt-3.5', 16_385],
  ['o1', 200_000],
  ['o3', 200_000],
  ['o4', 200_000],
  // Anthropic (all current Claude models are 200k)
  ['claude', 200_000],
  // Meta Llama — 3.1+ is 128k, 3.0 is 8k
  ['llama3.3', 131_072],
  ['llama-3.3', 131_072],
  ['llama3.2', 131_072],
  ['llama-3.2', 131_072],
  ['llama3.1', 131_072],
  ['llama-3.1', 131_072],
  ['llama3', 8_192],
  ['llama-3', 8_192],
  // Qwen
  ['qwen3', 131_072],
  ['qwen2.5', 131_072],
  ['qwen2', 32_768],
  // Mistral
  ['mixtral', 32_768],
  ['mistral-large', 131_072],
  ['mistral', 32_768],
  // DeepSeek
  ['deepseek', 131_072],
  // Google
  ['gemini-1.5', 1_048_576],
  ['gemini', 1_048_576],
  ['gemma3', 131_072],
  ['gemma2', 8_192],
  // Microsoft
  ['phi-3', 131_072],
  ['phi3', 131_072],
];

/** Match a model name against the curated table. Returns null if unknown. */
export function lookupContextWindow(model: string): number | null {
  const needle = model.toLowerCase();
  for (const [key, window] of KNOWN_CONTEXT_WINDOWS) {
    if (needle.includes(key)) return window;
  }
  return null;
}

/**
 * Extract the context length from an Ollama /api/show `model_info` object.
 * Ollama keys it as `<architecture>.context_length` (e.g. `llama.context_length`).
 * Exported for unit testing without a live server.
 */
export function parseOllamaContextWindow(modelInfo: unknown): number | null {
  if (!modelInfo || typeof modelInfo !== 'object') return null;
  const info = modelInfo as Record<string, unknown>;
  const arch = typeof info['general.architecture'] === 'string' ? (info['general.architecture'] as string) : null;
  const preferred = arch ? info[`${arch}.context_length`] : undefined;
  if (typeof preferred === 'number' && preferred > 0) return preferred;
  // Fallback: any *.context_length key with a positive number.
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) return value;
  }
  return null;
}

/**
 * Extract a context length from an OpenAI-compatible /v1/models payload for the
 * given model id. vLLM reports `max_model_len`; OpenRouter reports
 * `context_length`. Plain OpenAI reports neither (returns null). Exported for tests.
 */
export function parseOpenAiContextWindow(payload: unknown, model: string): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const entry = data.find(
    (m): m is Record<string, unknown> => !!m && typeof m === 'object' && (m as Record<string, unknown>).id === model,
  );
  if (!entry) return null;
  for (const field of ['max_model_len', 'context_length', 'context_window'] as const) {
    const value = entry[field];
    if (typeof value === 'number' && value > 0) return value;
  }
  return null;
}

async function probeOllama(baseUrl: string, model: string, timeoutMs: number): Promise<number | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { model_info?: unknown };
  return parseOllamaContextWindow(data.model_info);
}

async function probeOpenAi(
  baseUrl: string,
  model: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<number | null> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  return parseOpenAiContextWindow(await res.json(), model);
}

/**
 * Resolve a model's context window via override -> probe -> lookup -> unknown.
 * Never throws: a failed probe falls through to the lookup table.
 */
export async function resolveContextWindow(input: ResolveContextInput): Promise<ContextWindowResult> {
  const { provider, baseUrl, model, apiKey, override, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = input;

  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return { contextWindow: Math.floor(override), source: 'override' };
  }

  try {
    const probed =
      provider === 'ollama'
        ? await probeOllama(baseUrl, model, timeoutMs)
        : await probeOpenAi(baseUrl, model, apiKey, timeoutMs);
    if (probed !== null) return { contextWindow: probed, source: 'probe' };
  } catch {
    // Probe failed (offline, timeout, bad payload) — fall through to the table.
  }

  const known = lookupContextWindow(model);
  if (known !== null) return { contextWindow: known, source: 'lookup' };

  return { contextWindow: null, source: 'unknown' };
}
