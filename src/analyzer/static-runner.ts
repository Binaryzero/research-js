/**
 * Main-thread driver for the static-analysis worker.
 *
 * Owns the worker lifecycle: spawn, forward progress, resolve the result, and
 * guarantee the thread is torn down on success, failure, cancellation, or
 * timeout. Cancelling a scan now actually stops the CPU work instead of letting
 * it run to completion unobserved.
 */

import { Worker } from 'worker_threads';
import { getAnalysisLimits } from './analysis-limits.js';
import type { AnalysisResult } from '../types/index.js';
import type { StaticWorkerInput, StaticWorkerMessage } from './static-worker.js';
import { getComponentLogger } from '../services/logger.js';

export class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled');
    this.name = 'ScanCancelledError';
  }
}

export class ScanTimeoutError extends Error {
  constructor(ms: number) {
    super(`Static analysis exceeded ${ms}ms and was terminated`);
    this.name = 'ScanTimeoutError';
  }
}

export interface RunStaticAnalysisOptions {
  verbose?: boolean;
  patternsFile?: string;
  onProgress?: (fraction: number, message: string) => void;
  /** Abort to terminate the worker mid-scan (user cancel). */
  signal?: AbortSignal;
  /** Hard ceiling; terminates a wedged worker (e.g. catastrophic regex). */
  timeoutMs?: number;
}

/**
 * Locate the worker module and give it a loader that can resolve our imports.
 *
 * `new URL` is a literal path — it does not go through NodeNext's .js→.ts
 * resolution — so the extension is chosen explicitly: .ts when running from
 * source (dev/tests), .js when running from dist.
 *
 * The subtlety is the worker's OWN imports. This codebase uses NodeNext `.js`
 * specifiers that point at `.ts` files. Node can execute a .ts worker (native
 * type stripping) but will NOT remap `./static.js` → `./static.ts`, so the
 * worker must be started with tsx's resolver registered. From dist the
 * specifiers resolve natively and no loader is needed.
 */
function workerSpawnArgs(): { url: URL; execArgv: string[] } {
  const isTypeScript = import.meta.url.endsWith('.ts');
  return {
    url: new URL(isTypeScript ? './static-worker.ts' : './static-worker.js', import.meta.url),
    execArgv: isTypeScript ? ['--import', 'tsx'] : [],
  };
}

export function runStaticAnalysis(
  extensionPath: string,
  options: RunStaticAnalysisOptions = {},
): Promise<AnalysisResult> {
  const log = getComponentLogger('StaticWorker');

  const input: StaticWorkerInput = {
    extensionPath,
    verbose: options.verbose ?? false,
    patternsFile: options.patternsFile,
    // The worker has a fresh module graph: hand it the parent's limits.
    analysisLimits: getAnalysisLimits(),
  };

  return new Promise<AnalysisResult>((resolve, reject) => {
    const { url, execArgv } = workerSpawnArgs();
    const worker = new Worker(url, { workerData: input, execArgv });

    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    function onAbort() {
      settle(() => reject(new ScanCancelledError()));
    }

    if (options.signal) {
      if (options.signal.aborted) {
        // Already cancelled before we started — don't spin up work at all.
        settle(() => reject(new ScanCancelledError()));
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        log.warn({ extensionPath, timeoutMs: options.timeoutMs }, 'Static analysis timed out; terminating worker');
        settle(() => reject(new ScanTimeoutError(options.timeoutMs!)));
      }, options.timeoutMs);
      timer.unref?.();
    }

    worker.on('message', (msg: StaticWorkerMessage) => {
      if (msg.type === 'progress') {
        options.onProgress?.(msg.fraction, msg.message);
      } else if (msg.type === 'done') {
        settle(() => resolve(msg.result));
      } else if (msg.type === 'error') {
        settle(() => reject(new Error(msg.error)));
      }
    });

    worker.on('error', (err) => {
      settle(() => reject(err instanceof Error ? err : new Error(String(err))));
    });

    worker.on('exit', (code) => {
      // A non-zero exit before any result means the worker died unexpectedly.
      settle(() => reject(new Error(`Static analysis worker exited unexpectedly (code ${code})`)));
    });
  });
}
