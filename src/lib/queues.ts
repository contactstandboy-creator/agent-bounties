import { Queue, QueueEvents } from "bullmq";
import { createBullMQConnection } from "./redis";
import type {
  ClassifyJobData,
  ScoreJobData,
  ResearchJobData,
  ReputationUpdateJobData,
} from "@/types";

// ─── Queue Names ──────────────────────────────────────────────

export const QUEUE_NAMES = {
  CLASSIFY: "bounty:classify",
  SCORE: "bounty:score",
  RESEARCH: "agent:research",
  REVIEW: "submission:review",
  REPUTATION: "reputation:update",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Default Job Options ──────────────────────────────────────

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 2000,
  },
  removeOnComplete: { count: 100, age: 60 * 60 * 24 }, // Keep 100 jobs for 24h
  removeOnFail: { count: 500, age: 60 * 60 * 24 * 7 }, // Keep failures for 7d
};

// ─── Queue Factory ────────────────────────────────────────────

function makeQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name, {
    connection: createBullMQConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

// ─── Queue Instances ──────────────────────────────────────────

export const classifyQueue = makeQueue<ClassifyJobData>(QUEUE_NAMES.CLASSIFY);
export const scoreQueue = makeQueue<ScoreJobData>(QUEUE_NAMES.SCORE);
export const researchQueue = makeQueue<ResearchJobData>(QUEUE_NAMES.RESEARCH);
export const reputationQueue = makeQueue<ReputationUpdateJobData>(
  QUEUE_NAMES.REPUTATION
);

// ─── Queue Events (for monitoring) ───────────────────────────

export function createQueueEvents(queueName: string): QueueEvents {
  return new QueueEvents(queueName, {
    connection: createBullMQConnection(),
  });
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Enqueue a bounty for classification immediately.
 */
export async function enqueueClassify(
  data: ClassifyJobData,
  priority = 5
): Promise<string> {
  const job = await classifyQueue.add(`classify:${data.bountyId}`, data, {
    priority,
    jobId: `classify:${data.bountyId}`, // Dedup by bountyId
  });
  return job.id ?? "";
}

/**
 * Enqueue a classified bounty for opportunity scoring.
 */
export async function enqueueScore(data: ScoreJobData): Promise<string> {
  const job = await scoreQueue.add(`score:${data.bountyId}`, data, {
    jobId: `score:${data.bountyId}`,
  });
  return job.id ?? "";
}

/**
 * Enqueue a scored bounty for the research agent.
 */
export async function enqueueResearch(data: ResearchJobData): Promise<string> {
  const job = await researchQueue.add(`research:${data.bountyId}`, data, {
    attempts: 2, // Research is expensive; fewer retries
    backoff: { type: "fixed" as const, delay: 5000 },
  });
  return job.id ?? "";
}

/**
 * Enqueue a reputation update after a submission outcome is known.
 */
export async function enqueueReputationUpdate(
  data: ReputationUpdateJobData
): Promise<string> {
  const job = await reputationQueue.add(
    `reputation:${data.submissionId}`,
    data,
    { jobId: `reputation:${data.submissionId}` }
  );
  return job.id ?? "";
}

/**
 * Get queue depth stats for all queues (useful for admin dashboard).
 */
export async function getQueueDepths(): Promise<Record<string, number>> {
  const [classify, score, research, reputation] = await Promise.all([
    classifyQueue.getWaiting(),
    scoreQueue.getWaiting(),
    researchQueue.getWaiting(),
    reputationQueue.getWaiting(),
  ]);

  return {
    classify: classify.length,
    score: score.length,
    research: research.length,
    reputation: reputation.length,
  };
}
