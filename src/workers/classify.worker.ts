import { Worker, type Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { createBullMQConnection } from "@/lib/redis";
import { QUEUE_NAMES, enqueueScore } from "@/lib/queues";
import { createLogger } from "@/lib/logger";
import { classifyBounty } from "@/services/classifier/classifier.service";
import type { ClassifyJobData } from "@/types";

const log = createLogger("classify-worker");

export function startClassifyWorker(): Worker {
  const worker = new Worker<ClassifyJobData>(
    QUEUE_NAMES.CLASSIFY,
    async (job: Job<ClassifyJobData>) => {
      const { bountyId, title, description, rewardUsd } = job.data;
      log.info({ jobId: job.id, bountyId }, "Processing classify job");

      // 1. Run classification
      const result = await classifyBounty({
        bountyId,
        title,
        description,
        rewardUsd,
      });

      // 2. Persist classification to DB
      const classification = await prisma.classification.create({
        data: {
          bountyId,
          taskType: result.taskType,
          confidence: result.confidence,
          reasoning: result.reasoning,
          isAiDoable: result.isAiDoable,
          estimatedTimeMinutes: result.estimatedTimeMinutes,
          requiredTools: result.requiredTools,
          subTasks: result.subTasks ?? [],
          rawResponse: result.rawResponse ?? {},
        },
        select: { id: true },
      });

      // 3. Log compute cost
      await prisma.systemMetric.create({
        data: {
          name: "compute.cost",
          value: result.computeCost,
          labels: {
            service: "classifier",
            bountyId,
            taskType: result.taskType,
          },
        },
      });

      // 4. Emit event
      await prisma.event.create({
        data: {
          type: "BOUNTY_CLASSIFIED",
          bountyId,
          severity: "INFO",
          message: `Classified as ${result.taskType} (confidence: ${(result.confidence * 100).toFixed(1)}%, aiDoable: ${result.isAiDoable})`,
          data: {
            taskType: result.taskType,
            confidence: result.confidence,
            isAiDoable: result.isAiDoable,
          },
        },
      });

      // 5. If AI cannot do it, mark and stop
      if (!result.isAiDoable) {
        log.info(
          { bountyId, taskType: result.taskType },
          "Bounty not AI-doable — skipping scoring"
        );
        return { classified: true, isAiDoable: false, taskType: result.taskType };
      }

      // 6. Enqueue for opportunity scoring
      await enqueueScore({
        bountyId,
        classificationId: classification.id,
        rewardUsd,
        taskType: result.taskType,
        confidence: result.confidence,
      });

      log.info(
        { bountyId, taskType: result.taskType, confidence: result.confidence },
        "Classification done — enqueued for scoring"
      );

      return {
        classified: true,
        isAiDoable: true,
        taskType: result.taskType,
        confidence: result.confidence,
      };
    },
    {
      connection: createBullMQConnection(),
      concurrency: 3, // Classify 3 bounties in parallel
    }
  );

  worker.on("completed", (job) => {
    log.debug({ jobId: job.id }, "Classify job completed");
  });

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "Classify job failed");
  });

  worker.on("error", (err) => {
    log.error({ err }, "Classify worker error");
  });

  log.info("Classify worker started");
  return worker;
}
