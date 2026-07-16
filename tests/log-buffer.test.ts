/**
 * The log buffer backs the /logs page: every pino record must land in it,
 * be queryable by cursor/level/component, and never grow without bound.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendLogRecord,
  logBufferStream,
  getLogs,
  getLogComponents,
  clearLogBuffer,
  setLogForwarder,
} from '../src/services/log-buffer.js';

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { level: 30, time: 1_700_000_000_000, msg: 'hello', component: 'LLM', ...overrides };
}

describe('log buffer', () => {
  beforeEach(() => clearLogBuffer());

  it('appends records and returns them oldest-first with a cursor', () => {
    appendLogRecord(record({ msg: 'first' }));
    appendLogRecord(record({ msg: 'second' }));
    const { entries, lastSeq } = getLogs();

    expect(entries.map((e) => e.msg)).toEqual(['first', 'second']);
    expect(lastSeq).toBe(2);
    expect(entries[0].level).toBe('info');
    expect(entries[0].component).toBe('LLM');
  });

  it('a since-cursor poll returns only newer records', () => {
    appendLogRecord(record({ msg: 'old' }));
    const { lastSeq } = getLogs();
    appendLogRecord(record({ msg: 'new' }));

    const next = getLogs({ since: lastSeq });
    expect(next.entries.map((e) => e.msg)).toEqual(['new']);
  });

  it('filters by minimum level (warn+ hides info)', () => {
    appendLogRecord(record({ level: 30, msg: 'chatty' }));
    appendLogRecord(record({ level: 40, msg: 'warned' }));
    appendLogRecord(record({ level: 50, msg: 'errored' }));

    const { entries } = getLogs({ minLevel: 'warn' });
    expect(entries.map((e) => e.msg)).toEqual(['warned', 'errored']);
  });

  it('filters by component and tracks known components', () => {
    appendLogRecord(record({ component: 'LLM' }));
    appendLogRecord(record({ component: 'Orchestrator', msg: 'judge done' }));

    expect(getLogs({ component: 'Orchestrator' }).entries.map((e) => e.msg)).toEqual(['judge done']);
    expect(getLogComponents()).toEqual(['LLM', 'Orchestrator']);
  });

  it('captures structured extras compactly and defaults missing component to app', () => {
    appendLogRecord(record({ component: undefined, findingIndex: 7 }));
    const { entries } = getLogs();

    expect(entries[0].component).toBe('app');
    expect(entries[0].extra).toContain('"findingIndex":7');
  });

  it('drops the oldest records past capacity (ring behavior)', () => {
    for (let i = 0; i < 2100; i++) appendLogRecord(record({ msg: `m${i}` }));
    const { entries } = getLogs();

    expect(entries.length).toBe(2000);
    expect(entries[0].msg).toBe('m100'); // first 100 rolled off
    expect(entries[entries.length - 1].msg).toBe('m2099');
  });

  it('the stream feed parses NDJSON lines and ignores garbage', () => {
    logBufferStream.write(JSON.stringify(record({ msg: 'via stream' })));
    logBufferStream.write('not json at all');
    const { entries } = getLogs();

    expect(entries.map((e) => e.msg)).toEqual(['via stream']);
  });

  it('relays records to a forwarder (worker-thread bridge) and survives a throwing one', () => {
    const relayed: string[] = [];
    setLogForwarder((r) => relayed.push(String(r.msg)));
    appendLogRecord(record({ msg: 'relayed' }));
    expect(relayed).toEqual(['relayed']);

    setLogForwarder(() => { throw new Error('boom'); });
    appendLogRecord(record({ msg: 'still appended' }));
    expect(getLogs().entries.map((e) => e.msg)).toContain('still appended');
  });
});
