/**
 * Worker runner — starts all BullMQ workers and the indexer loop.
 * Run via: npm run workers
 *
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */
import { createLogger } from "@/lib/logger";
import { bootstrapAgents } from "@/services/reputation/reputation.service";
import { startIndexerLoop } from "@/services/indexer/indexer.service";
import { startClassifyWorker } from "./classify.worker";
import { startScoreWorker } from "./score.worker";
import { startResearchWorker } from "./research.worker";
import { startReputationWorker } from "./reputation.worker";
import type { Worker } from "bullmq";

const log = createLogger("worker-runner");

async function main(): Promise<void> {
  log.info("🚀 Starting Agent Bounties worker process");

  // 1. Bootstrap agents in DB
  log.info("Bootstrapping agent records...");
  await bootstrapAgents();
  log.info("Agents bootstrapped");

  // 2. Start all workers
  const workers: Worker[] = [
    startClassifyWorker(),
    startScoreWorker(),
    startResearchWorker(),
    startReputationWorker(),
  ];

  log.info(`${workers.length} workers started`);

  // 3. Start indexer loop (runs forever in the same process)
  log.info("Starting indexer loop...");
  // Run indexer in the background — don't await it
  void startIndexerLoop().catch((err) => {
    log.fatal({ err }, "Indexer loop crashed");
    process.exit(1);
  });

  // 4. Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, "Received shutdown signal");

    try {
      await Promise.all(workers.map((w) => w.close()));
      log.info("All workers closed gracefully");
      process.exit(0);
    } catch (err) {
      log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Catch unhandled errors
  process.on("unhandledRejection", (reason) => {
    log.error({ reason }, "Unhandled Promise rejection");
  });

  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });

  log.info("Worker process running — waiting for jobs");
}

main().catch((err) => {
  console.error("Worker runner failed to start:", err);
  process.exit(1);
});
