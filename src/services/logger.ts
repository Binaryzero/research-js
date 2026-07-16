import { pino, multistream } from 'pino';
import pretty from 'pino-pretty';
import { logBufferStream } from './log-buffer.js';

const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV !== 'production';

/** Provider error bodies can be large; keep enough to diagnose, not the whole payload. */
const MAX_RESPONSE_BODY_CHARS = 800;

/**
 * Compact error serializer.
 *
 * AI SDK errors (`AI_APICallError`) attach the ENTIRE request to the error object
 * via `requestBodyValues` — for our LLM calls that is the full prompt, often
 * several megabytes. pino's default error serializer copies every own-enumerable
 * property, so a single failed call dumped the whole prompt to the log (a 19-finding
 * scan produced a 2.7 MB log line from one failed summary call). This keeps the
 * fields that matter for diagnosis — type, message, status, url, a capped response
 * body, and the stack — and drops the payload-bearing ones (`requestBodyValues`,
 * `responseHeaders`, etc.). Every `{ err }` log site benefits without changes.
 */
function compactErrSerializer(err: unknown): unknown {
  if (!err || typeof err !== 'object') return err;
  const e = err as Record<string, unknown>;
  const out: Record<string, unknown> = {
    type: typeof e.name === 'string' ? e.name : 'Error',
    message: typeof e.message === 'string' ? e.message : String(e.message ?? ''),
  };
  if (e.statusCode != null) out.statusCode = e.statusCode;
  if (typeof e.url === 'string') out.url = e.url;
  if (typeof e.responseBody === 'string') {
    out.responseBody =
      e.responseBody.length > MAX_RESPONSE_BODY_CHARS
        ? `${e.responseBody.slice(0, MAX_RESPONSE_BODY_CHARS)}…[truncated]`
        : e.responseBody;
  }
  if (typeof e.stack === 'string') out.stack = e.stack;
  return out;
}

/**
 * Two destinations, one logger:
 *  - console: pino-pretty in development, raw NDJSON to stdout in production
 *  - the in-memory log buffer that backs the /logs page (see log-buffer.ts)
 *
 * pino-pretty runs as an in-process stream (not a worker transport) because a
 * transport cannot be combined with additional destination streams. Fastify is
 * given this same logger instance, so HTTP-layer messages land in the buffer too.
 */
const consoleStream = isDevelopment
  ? pretty({ colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' })
  : process.stdout;

export const logger = pino(
  {
    level: logLevel,
    serializers: { err: compactErrSerializer },
  },
  multistream([
    { level: logLevel, stream: consoleStream },
    { level: logLevel, stream: logBufferStream },
  ]),
);

/**
 * Creates a child logger for a specific component.
 * @param component The name of the component (e.g., 'Config', 'LLM')
 */
export function getComponentLogger(component: string) {
  return logger.child({ component });
}

export { compactErrSerializer };
export default logger;
