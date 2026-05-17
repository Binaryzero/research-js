/**
 * Scan history file I/O with per-path write serialization.
 *
 * All write operations across the process go through a per-path async queue
 * so concurrent scans cannot lose each other's updates via interleaved
 * read-modify-write. Writes are atomic (write-to-tmp then rename).
 */

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { writeFile, rename } from 'fs/promises';
import { dirname } from 'path';

export type HistoryScans = Record<string, unknown>;

export function loadHistory(path: string): HistoryScans {
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, 'utf-8');
    const data = JSON.parse(content);
    return data.scans || {};
  } catch {
    return {};
  }
}

async function writeHistoryAtomic(path: string, scans: HistoryScans): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${path}.tmp`;
  const payload = JSON.stringify({ scans, last_updated: new Date().toISOString() }, null, 2);
  await writeFile(tmp, payload, 'utf-8');
  await rename(tmp, path);
}

/**
 * Per-path FIFO queue of pending write operations. Each entry holds the tail
 * promise for that path; new work chains onto it so only one writer touches
 * a given history file at a time.
 */
const writeQueues: Map<string, Promise<void>> = new Map();

/**
 * Serialize a write operation against a given history path. The returned
 * promise resolves/rejects with the operation's result, but the queue tail
 * never enters a rejected state — a failing operation must not poison the
 * queue for subsequent callers.
 *
 * TODO(human): implement the serialization primitive.
 *
 * Requirements:
 *   1. Operations for the same `path` must run strictly in FIFO order
 *      (chained off `writeQueues.get(path)`).
 *   2. Operations for *different* paths run independently (no global lock).
 *   3. If `op()` throws/rejects, the caller of `enqueue` must see that
 *      rejection — but the queue's tail promise stored back in `writeQueues`
 *      must be a *resolved* continuation so the next enqueue still chains
 *      onto a usable promise (a rejected tail would cause every subsequent
 *      caller to receive the original error).
 *   4. When an operation finishes and no further work is chained, the entry
 *      should be cleaned up from the map to avoid unbounded growth.
 *      Hint: compare `writeQueues.get(path)` to the local tail before
 *      deleting — only the operation that owns the current tail may evict.
 *
 * Signature: takes a path and a thunk returning a promise; returns a promise
 * that mirrors the thunk's result.
 */
function enqueue<T>(path: string, op: () => Promise<T>): Promise<T> {
  throw new Error('TODO(human): implement per-path serialization queue');
}

/**
 * Apply a synchronous mutator to the scans map, then atomically persist.
 * The full read → mutate → write is serialized per path.
 */
export function updateHistory(
  path: string,
  mutator: (scans: HistoryScans) => void,
): Promise<void> {
  return enqueue(path, async () => {
    const scans = loadHistory(path);
    mutator(scans);
    await writeHistoryAtomic(path, scans);
  });
}

/**
 * Overwrite the entire scans map. Serialized against in-flight updates.
 */
export function saveHistory(path: string, scans: HistoryScans): Promise<void> {
  return enqueue(path, () => writeHistoryAtomic(path, scans));
}
