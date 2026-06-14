import Redis from "ioredis";
import { config } from "./config";
import { createLogger } from "./logger";

const log = createLogger("redis");

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

function createRedisClient(): Redis {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    lazyConnect: true,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      log.warn({ attempt: times, delayMs: delay }, "Redis reconnecting...");
      return delay;
    },
  });

  client.on("connect", () => log.info("Redis connected"));
  client.on("ready", () => log.info("Redis ready"));
  client.on("error", (err) => log.error({ err }, "Redis error"));
  client.on("close", () => log.warn("Redis connection closed"));
  client.on("reconnecting", () => log.warn("Redis reconnecting"));

  return client;
}

export const redis = globalThis.__redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__redis = redis;
}

/**
 * Create a separate Redis connection for BullMQ.
 * BullMQ requires its own dedicated connection.
 */
export function createBullMQConnection(): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
}

export default redis;
