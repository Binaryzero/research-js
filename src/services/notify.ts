/**
 * Native desktop notification (macOS) for high-risk detections, so the
 * operator hears about malware-grade findings even with no browser open.
 *
 * Click-to-open: a plain `osascript display notification` is owned by Script
 * Editor, so clicking it just launches Script Editor — it cannot open a URL.
 * When `terminal-notifier` is installed we use it with `-open <reportUrl>` so
 * clicking the banner opens the report directly. Without it we fall back to an
 * informational osascript banner (the actionable surface is then the in-app
 * task-tray alert, which carries the "Open report" link).
 *
 * SECURITY: the title/message embed extension metadata, which is
 * attacker-controlled (a hostile publisher names their extension anything).
 * Both notifier paths run via execFile (no shell). The osascript path also
 * interpolates text into an AppleScript string, so text is whitelisted to a
 * safe character set first — quotes/backslashes can never reach the script.
 * The report URL is constructed by the server (host/port + encoded report
 * name), never from raw metadata, and is passed as its own argv element.
 */

import { execFile } from 'child_process';
import { getComponentLogger } from './logger.js';

/** Characters allowed into the AppleScript string literal. */
const UNSAFE_CHARS = /[^a-zA-Z0-9 .,:;()\[\]_\/-]/g;
const MAX_TITLE_CHARS = 80;
const MAX_MESSAGE_CHARS = 180;
const NOTIFY_GROUP = 'extension-security-analyzer';

function sanitize(text: string, max: number): string {
  return text.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Logged once when terminal-notifier is absent, so the hint isn't spammy. */
let loggedTerminalNotifierHint = false;

export interface DesktopNotification {
  title: string;
  /** The core statement, e.g. "bad.ext scored 480 (Very Suspicious)." — no
   *  call-to-action; notifyDesktop appends one that matches the path used. */
  message: string;
  /** Absolute http URL opened when the banner is clicked (terminal-notifier only). */
  openUrl?: string;
}

/** Fire-and-forget; failure is logged at debug and never breaks the caller. */
export function notifyDesktop(notification: DesktopNotification): void {
  if (process.platform !== 'darwin') return;
  const title = sanitize(notification.title, MAX_TITLE_CHARS);
  const base = sanitize(notification.message, MAX_MESSAGE_CHARS);

  // Prefer terminal-notifier: its banner is clickable and can open the report,
  // so it's honest to say "click". Only add the CTA when we have a URL.
  const clickable = notification.openUrl
    ? sanitize(`${base} Click to open the report.`, MAX_MESSAGE_CHARS)
    : base;
  const tnArgs = ['-title', title, '-message', clickable, '-group', NOTIFY_GROUP, '-sound', 'Basso'];
  if (notification.openUrl) tnArgs.push('-open', notification.openUrl);

  execFile('terminal-notifier', tnArgs, (err) => {
    if (!err) return;
    // ENOENT (not installed) or any failure → informational osascript banner.
    // A scripted banner's click can't open a URL, so don't imply it can.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' && !loggedTerminalNotifierHint) {
      loggedTerminalNotifierHint = true;
      getComponentLogger('Notify').info(
        'Desktop banners are informational; install terminal-notifier (brew install terminal-notifier) to make clicking one open the report.',
      );
    }
    const info = sanitize(`${base} Review it in the analyzer.`, MAX_MESSAGE_CHARS);
    const script = `display notification "${info}" with title "${title}" sound name "Basso"`;
    execFile('osascript', ['-e', script], (osErr) => {
      if (osErr) getComponentLogger('Notify').debug({ err: osErr }, 'Desktop notification failed');
    });
  });
}
