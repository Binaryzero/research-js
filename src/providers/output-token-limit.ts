/**
 * Automatic max-output-token discovery.
 *
 * A model's real output limit is not reliably discoverable up front (Ollama's
 * /api/show reports the *context* length, not the output cap; hosted models
 * enforce their own limit). But the API tells us the exact number when a request
 * exceeds it, e.g.:
 *   "max_tokens (1048576) exceeds model's maximum output tokens (65536) for model deepseek-v4-flash"
 *
 * So we obtain the limit FROM the model: run the call, and on that error capture
 * N, cache it per model, and retry with N. Subsequent calls use the cached value
 * directly — no guessing, and every model self-corrects to a value it accepts.
 */

import { getComponentLogger } from '../services/logger.js';

/**
 * An output request larger than any real model's cap. Sending it forces the
 * model to reveal its true limit via the "maximum output tokens (N)" rejection —
 * used to proactively probe a model's output cap before running an analysis.
 */
export const OUTPUT_PROBE_TOKENS = 100_000_000;

/** In-memory cache of detected output limits, keyed by `${baseUrl}::${model}`. */
const detectedLimits = new Map<string, number>();

function cacheKey(baseUrl: string, model: string): string {
  return `${baseUrl}::${model}`;
}

/** The output limit learned for this model, if any. */
export function getDetectedOutputLimit(baseUrl: string, model: string): number | undefined {
  return detectedLimits.get(cacheKey(baseUrl, model));
}

/** Record a model's output limit (learned from the API's own error). */
export function rememberOutputLimit(baseUrl: string, model: string, limit: number): void {
  if (Number.isFinite(limit) && limit > 0) detectedLimits.set(cacheKey(baseUrl, model), limit);
}

/** All learned limits, for surfacing in the UI/config (`${baseUrl}::${model}` -> limit). */
export function getAllDetectedOutputLimits(): Record<string, number> {
  return Object.fromEntries(detectedLimits);
}

/**
 * Pull the model's maximum output tokens out of a provider error, if it reports
 * one. Handles the `responseBody` string (AI SDK APICallError) and a plain
 * message. Returns null when the error isn't an output-limit rejection.
 */
export function parseMaxOutputTokens(err: unknown): number | null {
  const text = errorText(err);
  if (!text) return null;
  // "... maximum output tokens (65536) ..." — the number is the model's cap.
  const match = /maximum output tokens \((\d+)\)/i.exec(text);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function errorText(err: unknown): string | null {
  if (!err || typeof err !== 'object') return typeof err === 'string' ? err : null;
  const e = err as Record<string, unknown>;
  // AI SDK APICallError carries the raw provider body here.
  if (typeof e.responseBody === 'string' && e.responseBody) return e.responseBody;
  if (typeof e.message === 'string') return e.message;
  return null;
}

/**
 * Run an LLM call with automatic output-limit handling.
 *
 * `requested` is the caller's desired output cap. If we've already learned this
 * model's limit, the first attempt is capped at it. Otherwise we try as-is; if
 * the API rejects it with a "maximum output tokens (N)" error, we learn N, cache
 * it, and retry once with N. Any other error propagates unchanged.
 */
export async function withOutputLimit<T>(
  baseUrl: string,
  model: string,
  requested: number,
  run: (maxOutputTokens: number) => Promise<T>,
): Promise<T> {
  const known = getDetectedOutputLimit(baseUrl, model);
  const firstAttempt = known ? Math.min(requested, known) : requested;
  try {
    return await run(firstAttempt);
  } catch (err) {
    const limit = parseMaxOutputTokens(err);
    if (limit !== null && limit < firstAttempt) {
      if (getDetectedOutputLimit(baseUrl, model) !== limit) {
        // One line per model per session — surfaces the value we obtained from
        // the model itself, without re-flooding the log on every later call.
        getComponentLogger('LLM').info(`Detected max output tokens for ${model}: ${limit} (was requesting ${firstAttempt})`);
      }
      rememberOutputLimit(baseUrl, model, limit);
      return run(limit); // retry with the model's actual maximum
    }
    throw err;
  }
}
