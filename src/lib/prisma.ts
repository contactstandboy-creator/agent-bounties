import { PrismaClient } from "@prisma/client";
import { createLogger } from "./logger";

const log = createLogger("prisma");

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  const client = new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
  });

  client.$on("error", (e) => {
    log.error({ target: e.target, message: e.message }, "Prisma error");
  });

  client.$on("warn", (e) => {
    log.warn({ target: e.target, message: e.message }, "Prisma warning");
  });

  // Only log slow queries
  client.$on("query", (e) => {
    if (e.duration > 500) {
      log.warn(
        { query: e.query, duration: e.duration, params: e.params },
        "Slow query detected"
      );
    }
  });

  return client;
}

// Prevent multiple Prisma instances in Next.js development hot-reload
export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

export default prisma;
