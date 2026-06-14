import { Worker, type Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { createBullMQConnection } from "@/lib/redis";
import { QUEUE_NAMES, enqueueResearch } from "@/lib/queues";
import { createLogger } from "@/lib/logger";
import { scoreBounty, selectAgentType } from "@/services/scorer/scorer.service";
import { getCategoryAccuracy, recordBid } from "@/services/reputation/reputation.service";
import type { ScoreJobData } from "@/types";

const log = createLogger("score-worker");

export function startScoreWorker(): Worker {
  const worker = new Worker<ScoreJobData>(
    QUEUE_NAMES.SCORE,
    async (job: Job<ScoreJobData>) => {
      const { bountyId, classificationId, rewardUsd, taskType, confidence } =
        job.data;

      log.info({ jobId: job.id, bountyId, taskType, rewardUsd }, "Processing score job");

      // 1. Select agent type for this task
      const agentType = selectAgentType(taskType);

      // 2. Get agent's historical performance for this category
      const categoryAccuracy = await getCategoryAccuracy(agentType, taskType);

      // 3. Calculate expected value
      const scoring = scoreBounty({
        bountyId,
        rewardUsd,
        taskType,
        confidence,
        agentType,
        categoryAccuracy,
        rolling30dScore: 0, // Will be fetched from reputation in future
        competitionEstimate: 0, // Auto-estimated by scorer
      });

      // 4. Persist bid decision
      const bid = await prisma.bid.create({
        data: {
          bountyId,
          classificationId,
          agentType,
          decision: scoring.decision,
          expectedValue: scoring.expectedValue,
          estimatedWinRate: scoring.estimatedWinRate,
          computeCostEst: scoring.computeCostEst,
          riskPenalty: scoring.riskPenalty,
          confidenceScore: scoring.confidenceScore,
          reasoning: scoring.reasoning,
        },
        select: { id: true },
      });

      // 5. Log event
      await prisma.event.create({
        data: {
          type: `BID_${scoring.decision}`,
          bountyId,
          severity: scoring.decision === "ACCEPTED" ? "INFO" : "DEBUG",
          message: `Bid decision: ${scoring.decision} | EV: $${scoring.expectedValue.toFixed(3)}`,
          data: {
            decision: scoring.decision,
            expectedValue: scoring.expectedValue,
            estimatedWinRate: scoring.estimatedWinRate,
            computeCostEst: scoring.computeCostEst,
          },
        },
      });

      // 6. If rejected, stop here
      if (scoring.decision !== "ACCEPTED") {
        log.info(
          { bountyId, decision: scoring.decision, expectedValue: scoring.expectedValue },
          "Bid rejected — skipping execution"
        );
        return { decision: scoring.decision, expectedValue: scoring.expectedValue };
      }

      // 7. Record bid in reputation system
      await recordBid(agentType);

      // 8. Fetch full bounty + classification details for agent context
      const bounty = await prisma.bounty.findUnique({
        where: { id: bountyId },
        include: { classification: true },
      });

      if (!bounty?.classification) {
        throw new Error(`Bounty ${bountyId} or classification not found`);
      }

      // 9. Route to appropriate agent queue
      if (agentType === "RESEARCH" || agentType === "DATA" || agentType === "VERIFY") {
        await enqueueResearch({
          bountyId,
          bidId: bid.id,
          title: bounty.title,
          description: bounty.description,
          rewardUsd: bounty.rewardUsd,
          taskType,
          classification: {
            taskType: bounty.classification.taskType,
            confidence: bounty.classification.confidence,
            reasoning: bounty.classification.reasoning,
            isAiDoable: bounty.classification.isAiDoable,
            estimatedTimeMinutes: bounty.classification.estimatedTimeMinutes ?? 30,
            requiredTools: bounty.classification.requiredTools,
            subTasks: bounty.classification.subTasks as unknown as string[] | undefined,
          },
        });
      }
      // TODO: Route CODING tasks to coding agent queue
      // TODO: Route IMAGE tasks to image agent queue

      log.info(
        { bountyId, agentType, bidId: bid.id, expectedValue: scoring.expectedValue },
        "Bid accepted — enqueued for agent execution"
      );

      return {
        decision: "ACCEPTED",
        expectedValue: scoring.expectedValue,
        agentType,
        bidId: bid.id,
      };
    },
    {
      connection: createBullMQConnection(),
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    log.debug({ jobId: job.id }, "Score job completed");
  });

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "Score job failed");
  });

  worker.on("error", (err) => {
    log.error({ err }, "Score worker error");
  });

  log.info("Score worker started");
  return worker;
}
