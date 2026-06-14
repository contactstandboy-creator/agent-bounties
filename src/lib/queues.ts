import { Queue, QueueEvents } from "bullmq";
import { createBullMQConnection } from "./redis";
import type {
  ClassifyJobData,
  ScoreJobData,
  ResearchJobData,
  ReputationUpdateJobData,
} from "@/types";

// ─── Queue Names ──────────────────────────────────────────────
// NOTE: BullMQ does not allow ":" in queue names (used internally as a
// Redis key delimiter). Use "-" instead.

export const QUEUE_NAMES = {
  CLASSIFY: "bounty-classify",
  SCORE: "bounty-score",
  RESEARCH: "agent-research",
  REVIEW: "submission-review",
  REPUTATION: "reputation-update",
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

// ─── Lazy Queue Singletons ────────────────────────────────────
//
// IMPORTANT: Queue instances must NOT be created at module load time.
// During `next build`, Next.js statically imports every route module to
// collect page data. If creating a BullMQ Queue (or its Redis connection)
// has any side effect that throws or blocks, the production build fails —
// even though the code path is never actually executed at build time.
//
// To avoid this entirely, each queue is created lazily on first use via
// these getter functions, and only ever called from inside request
// handlers / worker processes (never from module-level code).

let _classifyQueue: Queue<ClassifyJobData> | undefined;
let _scoreQueue: Queue<ScoreJobData> | undefined;
let _researchQueue: Queue<ResearchJobData> | undefined;
let _reputationQueue: Queue<ReputationUpdateJobData> | undefined;

function makeQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name, {
    connection: createBullMQConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export function getClassifyQueue(): Queue<ClassifyJobData> {
  if (!_classifyQueue) {
    _classifyQueue = makeQueue<ClassifyJobData>(QUEUE_NAMES.CLASSIFY);
  }
  return _classifyQueue;
}

export function getScoreQueue(): Queue<ScoreJobData> {
  if (!_scoreQueue) {
    _scoreQueue = makeQueue<ScoreJobData>(QUEUE_NAMES.SCORE);
  }
  return _scoreQueue;
}

export function getResearchQueue(): Queue<ResearchJobData> {
  if (!_researchQueue) {
    _researchQueue = makeQueue<ResearchJobData>(QUEUE_NAMES.RESEARCH);
  }
  return _researchQueue;
}

export function getReputationQueue(): Queue<ReputationUpdateJobData> {
  if (!_reputationQueue) {
    _reputationQueue = makeQueue<ReputationUpdateJobData>(QUEUE_NAMES.REPUTATION);
  }
  return _reputationQueue;
}

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
  const job = await getClassifyQueue().add(`classify:${data.bountyId}`, data, {
    priority,
    jobId: `classify:${data.bountyId}`, // Dedup by bountyId
  });
  return job.id ?? "";
}

/**
 * Enqueue a classified bounty for opportunity scoring.
 */
export async function enqueueScore(data: ScoreJobData): Promise<string> {
  const job = await getScoreQueue().add(`score:${data.bountyId}`, data, {
    jobId: `score:${data.bountyId}`,
  });
  return job.id ?? "";
}

/**
 * Enqueue a scored bounty for the research agent.
 */
export async function enqueueResearch(data: ResearchJobData): Promise<string> {
  const job = await getResearchQueue().add(`research:${data.bountyId}`, data, {
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
  const job = await getReputationQueue().add(
    `reputation:${data.submissionId}`,
    data,
    { jobId: `reputation:${data.submissionId}` }
  );
  return job.id ?? "";
}

/**
 * Get queue depth stats for all queues (useful for admin dashboard).
 * Wrapped in try/catch so a missing/unreachable Redis instance never
 * crashes the dashboard — it just shows zeros.
 */
export async function getQueueDepths(): Promise<Record<string, number>> {
  try {
    const [classify, score, research, reputation] = await Promise.all([
      getClassifyQueue().getWaiting(),
      getScoreQueue().getWaiting(),
      getResearchQueue().getWaiting(),
      getReputationQueue().getWaiting(),
    ]);

    return {
      classify: classify.length,
      score: score.length,
      research: research.length,
      reputation: reputation.length,
    };
  } catch {
    return { classify: 0, score: 0, research: 0, reputation: 0 };
  }
}
