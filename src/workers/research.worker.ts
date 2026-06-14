import { Worker, type Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { createBullMQConnection } from "@/lib/redis";
import { QUEUE_NAMES } from "@/lib/queues";
import { createLogger } from "@/lib/logger";
import { researchAgent } from "@/services/agents/research.agent";
import { BaseAgent } from "@/services/agents/base.agent";
import type { ResearchJobData } from "@/types";
import type { AgentType } from "@prisma/client";

const log = createLogger("research-worker");

export function startResearchWorker(): Worker {
  const worker = new Worker<ResearchJobData>(
    QUEUE_NAMES.RESEARCH,
    async (job: Job<ResearchJobData>) => {
      const { bountyId, bidId, title, description, rewardUsd, taskType, classification } =
        job.data;

      log.info({ jobId: job.id, bountyId, title, rewardUsd }, "Processing research job");

      const context = {
        bountyId,
        title,
        description,
        rewardUsd,
        taskType,
        classification,
      };

      // 1. Execute the research agent
      log.info({ bountyId }, "Executing research agent");
      const result = await researchAgent.execute(context);

      log.info(
        { bountyId, contentLength: result.content.length, sources: result.sources.length },
        "Research agent execution complete"
      );

      // 2. Auto-review the result
      // Use a simple BaseAgent-derived reviewer (we use BaseAgent's autoReview method)
      const reviewer = new (class extends BaseAgent {
        async execute() {
          return result;
        }
      })("auto-reviewer");

      const review = await reviewer.autoReview(context, result);

      log.info(
        { bountyId, autoScore: review.totalScore, passed: review.passed },
        "Auto-review complete"
      );

      // 3. Persist submission to DB
      const agentType: AgentType = "RESEARCH" as AgentType;
      const submission = await prisma.submission.create({
        data: {
          bountyId,
          bidId,
          agentType,
          content: result.content,
          summary: result.summary,
          sources: result.sources,
          computeCostActual: result.computeCostActual + review.computeCost,
          autoScore: review.totalScore,
          scoreBreakdown: review.breakdown,
          status: review.passed ? "AUTO_REVIEW_PASS" : "AUTO_REVIEW_FAIL",
          reviewedAt: new Date(),
        },
        select: { id: true },
      });

      // 4. Record metrics
      await prisma.systemMetric.create({
        data: {
          name: "compute.cost",
          value: result.computeCostActual + review.computeCost,
          labels: {
            service: "research-agent",
            bountyId,
            taskType,
            autoScore: review.totalScore,
          },
        },
      });

      // 5. Log event
      await prisma.event.create({
        data: {
          type: review.passed ? "SUBMISSION_READY" : "SUBMISSION_FAILED_REVIEW",
          bountyId,
          submissionId: submission.id,
          severity: review.passed ? "INFO" : "WARN",
          message: `Research complete. Auto-score: ${review.totalScore}/100 (${review.passed ? "PASS - ready to submit" : "FAIL - review needed"})`,
          data: {
            autoScore: review.totalScore,
            passed: review.passed,
            reasoning: review.reasoning,
            suggestions: review.suggestions,
            computeCost: result.computeCostActual + review.computeCost,
            sources: result.sources.length,
          },
        },
      });

      if (review.passed) {
        // 6a. Mark as ready for submission (human or automated)
        await prisma.submission.update({
          where: { id: submission.id },
          data: { status: "AUTO_REVIEW_PASS" },
        });

        log.info(
          { bountyId, submissionId: submission.id, autoScore: review.totalScore },
          "Submission passed auto-review — ready to submit to Pump.fun GO"
        );

        // TODO: Phase 2 — trigger automated submission to go.pump.fun
        // await submitToPumpfunGo(bountyId, submission.id);
      } else {
        log.warn(
          {
            bountyId,
            submissionId: submission.id,
            autoScore: review.totalScore,
            suggestions: review.suggestions,
          },
          "Submission failed auto-review — needs improvement"
        );

        // Could retry with more context or flag for human review
      }

      return {
        submissionId: submission.id,
        autoScore: review.totalScore,
        passed: review.passed,
        computeCost: result.computeCostActual + review.computeCost,
      };
    },
    {
      connection: createBullMQConnection(),
      concurrency: 2, // Research is expensive — limit parallelism
      limiter: {
        max: 10,
        duration: 60_000, // Max 10 research jobs per minute
      },
    }
  );

  worker.on("completed", (job) => {
    log.debug({ jobId: job.id }, "Research job completed");
  });

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, bountyId: job?.data?.bountyId, err }, "Research job failed");
  });

  worker.on("error", (err) => {
    log.error({ err }, "Research worker error");
  });

  log.info("Research worker started");
  return worker;
}
