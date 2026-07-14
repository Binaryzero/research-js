/**
 * Persistent job registry.
 *
 * Long-running work (scans, LLM re-analysis, batches) must outlive the page
 * that started it: the browser can navigate away, reconnect, or the server can
 * restart. The in-memory Map that used to hold scan state was invisible to
 * every other page and vanished on restart, so the UI silently "lost" tasks.
 *
 * This store is the single source of truth for job status. It keeps records in
 * memory for fast reads and mirrors them to disk so a restart can (a) report
 * what ran and (b) mark anything that was mid-flight as `interrupted` rather
 * than leaving it stuck at "running" forever.
 *
 * Writes are atomic (tmp + rename) and throttled: progress ticks fire many
 * times a second, so they only mark the store dirty; status transitions and an
 * interval flush do the actual persisting.
 */

import { existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { getComponentLogger } from './logger.js';

export type JobKind = 'scan' | 'llm-analyze' | 'batch';

export type JobStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'complete',
  'failed',
  'cancelled',
  'interrupted',
]);

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface JobRecord {
  id: string;
  kind: JobKind;
  /** What is being worked on (extension id or source URL). */
  target: string;
  /** Human-facing label for the task tray. */
  label: string;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  message: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** Report file name once written, so the UI can link straight to it. */
  reportName?: string;
  score?: number;
  error?: string;
}

export interface CreateJobInput {
  id?: string;
  kind: JobKind;
  target: string;
  label: string;
}

export type JobPatch = Partial<
  Pick<JobRecord, 'status' | 'progress' | 'message' | 'reportName' | 'score' | 'error'>
>;

export interface JobStoreOptions {
  /** How many terminal (finished) jobs to retain. Active jobs are never pruned. */
  maxTerminal?: number;
  /** Throttle interval for background flushes, ms. */
  flushIntervalMs?: number;
}

const DEFAULT_MAX_TERMINAL = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 1000;

interface JobsFile {
  version: number;
  jobs: JobRecord[];
}

export class JobStore {
  private readonly path: string;
  private readonly maxTerminal: number;
  private readonly flushIntervalMs: number;
  private jobs = new Map<string, JobRecord>();
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly log = getComponentLogger('Jobs');

  constructor(path: string, options: JobStoreOptions = {}) {
    this.path = path;
    this.maxTerminal = options.maxTerminal ?? DEFAULT_MAX_TERMINAL;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  /**
   * Load persisted jobs. Any job still marked pending/running belonged to a
   * process that is gone, so it is reclassified as `interrupted` — the UI must
   * never show a task as running when nothing is running it.
   */
  load(): void {
    this.jobs.clear();
    if (!existsSync(this.path)) return;

    let parsed: JobsFile | undefined;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as JobsFile;
    } catch (err) {
      // A corrupt jobs file must not take the server down; start clean.
      this.log.warn({ err, path: this.path }, 'Jobs file unreadable; starting with an empty registry');
      return;
    }

    if (!parsed || !Array.isArray(parsed.jobs)) return;

    const now = new Date().toISOString();
    for (const job of parsed.jobs) {
      if (!job || typeof job.id !== 'string') continue;
      if (!isTerminal(job.status)) {
        this.jobs.set(job.id, {
          ...job,
          status: 'interrupted',
          error: 'Interrupted — the server restarted while this job was running',
          finishedAt: job.finishedAt ?? now,
          updatedAt: now,
        });
        this.dirty = true;
      } else {
        this.jobs.set(job.id, job);
      }
    }
  }

  create(input: CreateJobInput): JobRecord {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: input.id ?? randomUUID().slice(0, 12),
      kind: input.kind,
      target: input.target,
      label: input.label,
      status: 'pending',
      progress: 0,
      message: '',
      startedAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    this.dirty = true;
    // A newly created job is worth persisting immediately: if the server dies
    // seconds later we still want a record that it was attempted.
    void this.flush();
    return job;
  }

  update(id: string, patch: JobPatch): JobRecord | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const next: JobRecord = { ...existing, ...patch, updatedAt: now };

    const becameTerminal =
      patch.status !== undefined && isTerminal(patch.status) && !isTerminal(existing.status);
    if (becameTerminal) {
      next.finishedAt = now;
    }

    this.jobs.set(id, next);
    this.dirty = true;

    // Status transitions are the moments worth durably recording; plain progress
    // ticks ride the throttled flush.
    if (patch.status !== undefined) {
      void this.flush();
      if (becameTerminal) this.prune();
    }

    return next;
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  /** All jobs, newest first. */
  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Jobs that are still pending or running. */
  listActive(): JobRecord[] {
    return this.list().filter(j => !isTerminal(j.status));
  }

  /** Drop the oldest terminal jobs beyond the retention cap. Active jobs are kept. */
  prune(): void {
    const terminal = this.list().filter(j => isTerminal(j.status));
    if (terminal.length <= this.maxTerminal) return;

    // list() is newest-first, so anything past the cap is the oldest.
    for (const job of terminal.slice(this.maxTerminal)) {
      this.jobs.delete(job.id);
    }
    this.dirty = true;
    void this.flush();
  }

  /** Start the periodic flush so progress ticks eventually reach disk. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.dirty) void this.flush();
    }, this.flushIntervalMs);
    // Never hold the process open just to flush job state.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Persist atomically: write a temp file, then rename over the target. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;

    const payload: JobsFile = { version: 1, jobs: this.list() };
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${randomUUID()}.tmp`;
      writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
      renameSync(tmp, this.path);
    } catch (err) {
      // Persisting job state is best-effort: losing it must never fail a scan.
      this.dirty = true;
      this.log.warn({ err, path: this.path }, 'Failed to persist job registry');
    }
  }
}
