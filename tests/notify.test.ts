/**
 * High-risk desktop notifications prefer terminal-notifier (clickable, opens
 * the report) and fall back to an informational osascript banner. The banner
 * must never promise a click action the fallback can't deliver.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFile: execFileMock }));

import { notifyDesktop } from '../src/services/notify.js';

const ENOENT = Object.assign(new Error('spawn terminal-notifier ENOENT'), { code: 'ENOENT' });

describe('notifyDesktop', () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    execFileMock.mockReset();
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  it('uses terminal-notifier with -open and a click CTA when it succeeds', () => {
    execFileMock.mockImplementation((_cmd, _args, cb) => cb(null));
    notifyDesktop({ title: 'High-risk extension detected', message: 'bad.ext scored 480 (Very Suspicious).', openUrl: 'http://127.0.0.1:8001/report/bad.ext.md' });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe('terminal-notifier');
    expect(args).toContain('-open');
    expect(args[args.indexOf('-open') + 1]).toBe('http://127.0.0.1:8001/report/bad.ext.md');
    expect(args.join(' ')).toContain('Click to open the report.');
  });

  it('falls back to osascript (no false click promise) when terminal-notifier is absent', () => {
    execFileMock.mockImplementationOnce((_cmd, _args, cb) => cb(ENOENT)); // terminal-notifier
    execFileMock.mockImplementationOnce((_cmd, _args, cb) => cb(null)); // osascript
    notifyDesktop({ title: 'High-risk extension detected', message: 'bad.ext scored 480 (Very Suspicious).', openUrl: 'http://127.0.0.1:8001/report/bad.ext.md' });

    expect(execFileMock).toHaveBeenCalledTimes(2);
    const [cmd, args] = execFileMock.mock.calls[1];
    expect(cmd).toBe('osascript');
    const script = args[1];
    expect(script).toContain('Review it in the analyzer.');
    expect(script).not.toContain('Click to open');
  });

  it('strips characters that could break the AppleScript string', () => {
    execFileMock.mockImplementationOnce((_cmd, _args, cb) => cb(ENOENT));
    execFileMock.mockImplementationOnce((_cmd, _args, cb) => cb(null));
    notifyDesktop({ title: 'evil"; do shell script "rm -rf', message: 'x`$(whoami)` \\ done' });

    const script = execFileMock.mock.calls[1][1][1] as string;
    // Exactly 6 double-quotes = our 3 delimiter pairs (message/title/sound);
    // any leaked quote from the input would break the count.
    expect((script.match(/"/g) || []).length).toBe(6);
    expect(script).not.toContain('\\');
    expect(script).not.toContain('$');
    expect(script).not.toContain('`');
  });

  it('is a no-op off macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    notifyDesktop({ title: 't', message: 'm' });
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
