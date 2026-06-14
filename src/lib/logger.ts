import pino from "pino";
import { config } from "./config";

const isDev = config.NODE_ENV === "development";

export const logger = pino({
  level: config.LOG_LEVEL,
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {
        // Production: JSON to stdout
        formatters: {
          level: (label: string) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});

export type Logger = typeof logger;

/**
 * Create a child logger with a fixed `service` binding.
 * Every service, worker, and agent should call this.
 *
 * @example
 * const log = createLogger("classifier");
 * log.info({ bountyId }, "Classifying bounty");
 */
export function createLogger(service: string, extra?: Record<string, unknown>) {
  return logger.child({ service, ...extra });
}
