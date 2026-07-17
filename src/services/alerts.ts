/**
 * Persistent high-risk alerts.
 *
 * Raised when an automatic sweep scans an extension whose static suspicion
 * score crosses the operator's alert threshold — the "you weren't looking,
 * look now" signal. Alerts survive restarts (JSON file) and stay visible in
 * the task tray until acknowledged, each linking straight to its report.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { getComponentLogger } from './logger.js';

export interface HighRiskAlert {
  id: string;
  extensionId: string;
  version: string;
  score: number;
  riskLabel: string;
  /** Report file name (…​.md) for the "Open report" link; null if none written. */
  reportName: string | null;
  /** Top non-false-positive critical/high finding titles — the "why". */
  topFindings: string[];
  createdAt: string;
  acknowledged: boolean;
}

export interface RaiseAlertInput {
  extensionId: string;
  version: string;
  score: number;
  riskLabel: string;
  reportName: string | null;
  topFindings: string[];
}

/** Retention cap — oldest acknowledged alerts are dropped past this. */
const MAX_ALERTS = 500;

export class AlertStore {
  private alerts: HighRiskAlert[] = [];
  private readonly log = getComponentLogger('Alerts');

  constructor(private readonly path: string) {}

  load(): void {
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as unknown;
      if (Array.isArray(parsed)) {
        this.alerts = parsed.filter(
          (a): a is HighRiskAlert =>
            !!a && typeof a === 'object' && typeof (a as HighRiskAlert).id === 'string',
        );
      }
    } catch (err) {
      this.log.warn({ err, path: this.path }, 'Alerts file unreadable; starting empty');
      this.alerts = [];
    }
  }

  /**
   * Raise an alert. Deduplicates on extensionId+version — a re-scan of the
   * same version must not re-nag; a NEW version scoring high alerts again.
   * Returns the alert, or null when this exact version already alerted.
   */
  raise(input: RaiseAlertInput): HighRiskAlert | null {
    const exists = this.alerts.some(
      (a) => a.extensionId === input.extensionId && a.version === input.version,
    );
    if (exists) return null;

    const alert: HighRiskAlert = {
      id: randomUUID().slice(0, 12),
      ...input,
      createdAt: new Date().toISOString(),
      acknowledged: false,
    };
    this.alerts = [alert, ...this.alerts];
    this.trim();
    this.persist();
    return alert;
  }

  acknowledge(id: string): boolean {
    const found = this.alerts.find((a) => a.id === id);
    if (!found) return false;
    this.alerts = this.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a));
    this.persist();
    return true;
  }

  acknowledgeAll(): number {
    const open = this.alerts.filter((a) => !a.acknowledged).length;
    if (open === 0) return 0;
    this.alerts = this.alerts.map((a) => (a.acknowledged ? a : { ...a, acknowledged: true }));
    this.persist();
    return open;
  }

  /** Newest first. */
  list(): HighRiskAlert[] {
    return [...this.alerts];
  }

  unacknowledgedCount(): number {
    return this.alerts.filter((a) => !a.acknowledged).length;
  }

  private trim(): void {
    if (this.alerts.length <= MAX_ALERTS) return;
    // Never drop an unacknowledged alert to make room — drop oldest acked.
    const unacked = this.alerts.filter((a) => !a.acknowledged);
    const acked = this.alerts.filter((a) => a.acknowledged);
    const keepAcked = acked.slice(0, Math.max(0, MAX_ALERTS - unacked.length));
    this.alerts = [...unacked, ...keepAcked].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private persist(): void {
    try {
      writeFileSync(this.path, JSON.stringify(this.alerts, null, 2));
    } catch (err) {
      this.log.warn({ err, path: this.path }, 'Failed to persist alerts');
    }
  }
}
