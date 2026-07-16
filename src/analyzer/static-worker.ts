/**
 * Worker entry: runs static analysis off the main thread.
 *
 * Static analysis is CPU-bound and synchronous (readFileSync + regex scans over
 * every line of every file). On the main thread it blocks the Node event loop
 * for the whole scan, which stalls SSE keepalives and queues every other HTTP
 * request — the server appears frozen and the UI looks disconnected.
 *
 * Running it here keeps the server responsive, lets multiple scans run in
 * parallel, and makes the work killable: a catastrophically backtracking regex
 * (patterns.yaml is operator-editable) wedges this worker, which the main
 * thread can terminate, instead of wedging the whole application.
 *
 * The worker gets its own module graph, so module-level singletons do NOT carry
 * over from the parent — analysis limits must be seeded explicitly.
 */

import { parentPort, workerData } from 'worker_threads';
import type { AnalysisResult, AnalysisLimits } from '../types/index.js';
import { StaticAnalyzer } from './static.js';
import { setAnalysisLimits } from './analysis-limits.js';
import { setLogForwarder } from '../services/log-buffer.js';

export interface StaticWorkerInput {
  extensionPath: string;
  verbose?: boolean;
  patternsFile?: string;
  /** Seeded explicitly: the worker does not share the parent's module state. */
  analysisLimits?: AnalysisLimits;
}

export type StaticWorkerMessage =
  | { type: 'progress'; fraction: number; message: string }
  | { type: 'log'; record: Record<string, unknown> }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; error: string };

async function main(): Promise<void> {
  if (!parentPort) throw new Error('static-worker must be run as a worker thread');
  const input = workerData as StaticWorkerInput;

  if (input.analysisLimits) {
    setAnalysisLimits(input.analysisLimits);
  }

  // The worker's log-buffer instance is a separate module singleton the UI never
  // sees — relay every record to the main thread so 'Static'/'Patterns' logs
  // show up in /logs like everything else.
  const port = parentPort;
  setLogForwarder((record) => {
    const msg: StaticWorkerMessage = { type: 'log', record };
    port.postMessage(msg);
  });

  const analyzer = new StaticAnalyzer(input.extensionPath, {
    verbose: input.verbose ?? false,
    patternsFile: input.patternsFile,
    onProgress: (fraction, message) => {
      const msg: StaticWorkerMessage = { type: 'progress', fraction, message };
      parentPort!.postMessage(msg);
    },
  });

  const result = await analyzer.analyze();
  const msg: StaticWorkerMessage = { type: 'done', result };
  parentPort.postMessage(msg);
}

main().catch((err: unknown) => {
  const msg: StaticWorkerMessage = {
    type: 'error',
    error: err instanceof Error ? err.message : String(err),
  };
  parentPort?.postMessage(msg);
});
