/**
 * In-memory ring buffer of recent log records, so the UI can show the REAL
 * application log (LLM calls, orchestrator, scans, errors) instead of a tiny
 * curated status line. Fed by a pino destination stream (see logger.ts), so
 * every logger call in the process lands here with zero call-site changes.
 *
 * Consumers poll GET /api/logs with a `since` sequence cursor — the same
 * polling model the task tray already uses — so no extra socket machinery.
 */

/** Max records retained. Old records are dropped as new ones arrive. */
const MAX_ENTRIES = 2000;

/** Cap on the serialized extra-fields blob per record, so one giant object
 * (however unlikely post-serializer) can never bloat the buffer or the UI. */
const MAX_EXTRA_CHARS = 4000;

/** Pino numeric levels → labels. */
const LEVEL_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/** Standard pino keys that are rendered as dedicated fields, not "extra". */
const STANDARD_KEYS = new Set(['level', 'time', 'msg', 'component', 'pid', 'hostname']);

export interface LogEntry {
  /** Monotonic sequence number — the polling cursor. */
  seq: number;
  /** Epoch millis. */
  time: number;
  level: string;
  component: string;
  msg: string;
  /** Compact JSON of any structured fields beyond the standard ones. */
  extra?: string;
}

const entries: LogEntry[] = [];
let nextSeq = 1;
const knownComponents = new Set<string>();

/**
 * Optional per-thread forwarder. Worker threads get their own module graph, so
 * their buffer instance is invisible to /api/logs — a worker sets this to relay
 * each record to the main thread (via parentPort), where it is appended to the
 * real buffer. See static-worker.ts / static-runner.ts.
 */
type LogForwarder = (record: Record<string, unknown>) => void;
let forwarder: LogForwarder | null = null;

export function setLogForwarder(fn: LogForwarder): void {
  forwarder = fn;
}

/** Append a parsed pino record. Exposed for tests; production feed is the stream. */
export function appendLogRecord(record: Record<string, unknown>): void {
  if (forwarder) {
    try {
      forwarder(record);
    } catch {
      // forwarding must never break logging
    }
  }
  const levelNum = typeof record.level === 'number' ? record.level : 30;
  const extraKeys = Object.keys(record).filter((k) => !STANDARD_KEYS.has(k));
  let extra: string | undefined;
  if (extraKeys.length > 0) {
    try {
      const blob = JSON.stringify(Object.fromEntries(extraKeys.map((k) => [k, record[k]])));
      extra = blob.length > MAX_EXTRA_CHARS ? `${blob.slice(0, MAX_EXTRA_CHARS)}…` : blob;
    } catch {
      extra = undefined; // circular or unserializable — drop the extras, keep the record
    }
  }
  const component = typeof record.component === 'string' && record.component ? record.component : 'app';
  knownComponents.add(component);
  entries.push({
    seq: nextSeq++,
    time: typeof record.time === 'number' ? record.time : Date.now(),
    level: LEVEL_LABELS[levelNum] ?? String(levelNum),
    component,
    msg: typeof record.msg === 'string' ? record.msg : '',
    ...(extra !== undefined && { extra }),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/**
 * A pino destination stream: receives NDJSON lines and appends each to the
 * buffer. Malformed lines are ignored — the buffer must never take the
 * process down, whatever the log pipeline emits.
 */
export const logBufferStream = {
  write(line: string): void {
    try {
      appendLogRecord(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // not JSON (or partial line) — skip
    }
  },
};

export interface LogQuery {
  /** Return only records with seq > since (0 = everything retained). */
  since?: number;
  /** Minimum severity to include (e.g. 'warn' = warn+error+fatal). */
  minLevel?: string;
  /** Only records from this component. */
  component?: string;
  /** Max records returned (most recent kept). */
  limit?: number;
}

const LEVEL_ORDER: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

/** Records matching the query, oldest first, plus the cursor for the next poll. */
export function getLogs(query: LogQuery = {}): { entries: LogEntry[]; lastSeq: number } {
  const since = query.since ?? 0;
  const minLevel = query.minLevel ? (LEVEL_ORDER[query.minLevel] ?? 0) : 0;
  const limit = query.limit && query.limit > 0 ? query.limit : MAX_ENTRIES;

  let matched = entries.filter(
    (e) =>
      e.seq > since &&
      (minLevel === 0 || (LEVEL_ORDER[e.level] ?? 0) >= minLevel) &&
      (!query.component || e.component === query.component),
  );
  if (matched.length > limit) matched = matched.slice(matched.length - limit);
  return { entries: matched, lastSeq: nextSeq - 1 };
}

/** Every component name seen this session — powers the UI filter dropdown. */
export function getLogComponents(): string[] {
  return [...knownComponents].sort();
}

/** Test hook: reset the buffer to empty (and drop any installed forwarder). */
export function clearLogBuffer(): void {
  entries.length = 0;
  nextSeq = 1;
  knownComponents.clear();
  forwarder = null;
}
