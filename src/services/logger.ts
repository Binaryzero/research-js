import { pino } from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: logLevel,
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/**
 * Creates a child logger for a specific component.
 * @param component The name of the component (e.g., 'Config', 'LLM')
 */
export function getComponentLogger(component: string) {
  return logger.child({ component });
}

export default logger;
