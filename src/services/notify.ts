/**
 * Native desktop notification (macOS) for high-risk detections, so the
 * operator hears about malware-grade findings even with no browser open.
 *
 * SECURITY: the notification text embeds extension metadata, which is
 * attacker-controlled (a hostile publisher names their extension whatever
 * they like). The text is interpolated into an AppleScript string, so it is
 * whitelisted to a safe character set FIRST — quotes and backslashes can
 * never reach the script. osascript runs via execFile (no shell).
 */

import { execFile } from 'child_process';
import { getComponentLogger } from './logger.js';

/** Characters allowed into the AppleScript string literal. */
const UNSAFE_CHARS = /[^a-zA-Z0-9 .,:;()\[\]_\/-]/g;
const MAX_TITLE_CHARS = 80;
const MAX_MESSAGE_CHARS = 180;

function sanitize(text: string, max: number): string {
  return text.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Fire-and-forget; failure is logged at debug and never breaks the caller. */
export function notifyDesktop(title: string, message: string): void {
  if (process.platform !== 'darwin') return;
  const safeTitle = sanitize(title, MAX_TITLE_CHARS);
  const safeMessage = sanitize(message, MAX_MESSAGE_CHARS);
  const script = `display notification "${safeMessage}" with title "${safeTitle}" sound name "Basso"`;
  execFile('osascript', ['-e', script], (err) => {
    if (err) getComponentLogger('Notify').debug({ err }, 'Desktop notification failed');
  });
}
