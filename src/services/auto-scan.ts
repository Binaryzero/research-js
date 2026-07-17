/**
 * Automatic marketplace sweeps.
 *
 * Every `intervalMinutes` (operator-configured, off by default), fetch the
 * newest extensions from the marketplace, drop the ones already scanned, and
 * run a static-only batch scan of the rest. Alerting on high scores happens
 * in the scan pipeline the sweep triggers (see index.ts wiring) — this module
 * only owns the schedule and the sweep lifecycle.
 *
 * Hooks are injected so the scheduler stays decoupled from the server's
 * search/scan machinery (and trivially testable).
 */

import type { AutoScanConfig } from '../types/index.js';
import { getComponentLogger } from './logger.js';

/** Minimal shape the sweep needs — marketplace results satisfy it structurally. */
export interface SweepCandidate {
  extensionId: string;
  /** Marketplace stats; installCount feeds the alert guardrail. */
  statistics?: { installCount?: number };
}

export interface AutoScanHooks {
  /** Newest `count` marketplace extensions that have never been scanned. */
  findNewExtensions(count: number): Promise<SweepCandidate[]>;
  /** Run the static batch scan; resolves when the sweep's scan completes. */
  startSweep(extensions: SweepCandidate[]): Promise<void>;
}

export interface SweepResult {
  /** False when a sweep was already in progress (this one was skipped). */
  started: boolean;
  newCount: number;
}

export class AutoScanScheduler {
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private config: AutoScanConfig | null = null;
  private readonly log = getComponentLogger('AutoScan');

  constructor(private readonly hooks: AutoScanHooks) {}

  /** Apply (or re-apply) config: restarts the timer, or stops when disabled. */
  configure(config: AutoScanConfig): void {
    // Saving unrelated settings re-posts the whole config; recreating the
    // timer would reset the countdown each time, so frequent saves could
    // postpone the sweep indefinitely. Unchanged schedule = keep the phase.
    const unchanged = this.config && JSON.stringify(this.config) === JSON.stringify(config);
    if (unchanged && (this.timer !== null || !config.enabled)) return;
    this.stop();
    this.config = config;
    if (!config.enabled) return;
    const intervalMs = config.intervalMinutes * 60_000;
    this.timer = setInterval(() => {
      void this.runSweep().catch((err) => this.log.warn({ err }, 'Scheduled sweep failed'));
    }, intervalMs);
    // Don't keep the process alive just for the schedule.
    this.timer.unref?.();
    this.log.info(
      `Automatic scanning enabled: every ${config.intervalMinutes} min, newest ${config.count} extensions`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isSweeping(): boolean {
    return this.sweeping;
  }

  /**
   * One sweep: find never-scanned newcomers, batch-scan them. Also the
   * handler behind the manual "Run sweep now" button, so it works regardless
   * of the enabled flag. Overlapping sweeps are skipped, not queued.
   */
  async runSweep(): Promise<SweepResult> {
    if (this.sweeping) {
      this.log.info('Sweep already in progress; skipping this run');
      return { started: false, newCount: 0 };
    }
    this.sweeping = true;
    let releaseNow = true;
    try {
      const count = this.config?.count ?? 50;
      const fresh = await this.hooks.findNewExtensions(count);
      if (fresh.length === 0) {
        this.log.info('Sweep: no new extensions since last check');
        return { started: true, newCount: 0 };
      }
      this.log.info(`Sweep: ${fresh.length} new extension(s) — starting static scan`);
      // Fire the scan and resolve immediately — the "Run sweep now" API (and
      // the timer) must not block for the whole batch. The overlap guard stays
      // held until the scan settles so sweeps never stack.
      releaseNow = false;
      void this.hooks
        .startSweep(fresh)
        .catch((err) => this.log.warn({ err }, 'Sweep scan failed'))
        .finally(() => {
          this.sweeping = false;
        });
      return { started: true, newCount: fresh.length };
    } finally {
      if (releaseNow) this.sweeping = false;
    }
  }
}
