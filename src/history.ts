/**
 * Scan history file I/O with per-path write serialization.
 *
 * All write operations across the process go through a per-path async queue
 * so concurrent scans cannot lose each other's updates via interleaved
 * read-modify-write. Writes are atomic (write-to-tmp then rename).
 *
 * Per-write temp filenames carry a random suffix so that multiple Node
 * processes sharing the same history file cannot race on a fixed `.tmp`
 * path (one process's rename winning would otherwise cause the other's
 * rename to fail with ENOENT and surface as a spurious scan failure).
 */

import { existsSync, readFileSync } from 'fs';
import { writeFile, rename, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

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
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
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

function enqueue<T>(path: string, op: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(path) ?? Promise.resolve();
  const run = prev.then(op);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(path, tail);
  tail.then(() => {
    if (writeQueues.get(path) === tail) {
      writeQueues.delete(path);
    }
  });
  return run;
}

/**
 * Apply a mutator to the scans map, then atomically persist. The full
 * read → mutate → write is serialized per path. The mutator's return value
 * is forwarded to the caller, so callers can observe (e.g. "was this key
 * present?") inside the same atomic block they used to modify.
 */
export function updateHistory<T>(
  path: string,
  mutator: (scans: HistoryScans) => T,
): Promise<T> {
  return enqueue(path, async () => {
    const scans = loadHistory(path);
    const result = mutator(scans);
    await writeHistoryAtomic(path, scans);
    return result;
  });
}

/**
 * Overwrite the entire scans map. Serialized against in-flight updates.
 */
export function saveHistory(path: string, scans: HistoryScans): Promise<void> {
  return enqueue(path, () => writeHistoryAtomic(path, scans));
}
