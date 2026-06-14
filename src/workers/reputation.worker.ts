import { Worker, type Job } from "bullmq";
import { createBullMQConnection } from "@/lib/redis";
import { QUEUE_NAMES } from "@/lib/queues";
import { createLogger } from "@/lib/logger";
import { recordOutcome } from "@/services/reputation/reputation.service";
import type { ReputationUpdateJobData } from "@/types";

const log = createLogger("reputation-worker");

export function startReputationWorker(): Worker {
  const worker = new Worker<ReputationUpdateJobData>(
    QUEUE_NAMES.REPUTATION,
    async (job: Job<ReputationUpdateJobData>) => {
      const data = job.data;
      log.info(
        { jobId: job.id, submissionId: data.submissionId, outcome: data.outcome },
        "Processing reputation update"
      );

      await recordOutcome({
        submissionId: data.submissionId,
        bountyId: data.bountyId,
        agentType: data.agentType,
        outcome: data.outcome,
        payoutAmount: data.payoutAmount,
        computeCostActual: data.computeCostActual,
        autoScore: data.autoScore,
        taskType: data.taskType,
      });

      return { updated: true, submissionId: data.submissionId };
    },
    {
      connection: createBullMQConnection(),
      concurrency: 1, // Reputation updates must be sequential per agent
    }
  );

  worker.on("completed", (job) => {
    log.debug({ jobId: job.id }, "Reputation job completed");
  });

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "Reputation job failed");
  });

  log.info("Reputation worker started");
  return worker;
}
