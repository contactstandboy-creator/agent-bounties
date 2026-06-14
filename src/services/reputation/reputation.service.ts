import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import type { AgentStats, CategoryScore } from "@/types";
import type { AgentType, SubmissionStatus, TaskType } from "@prisma/client";

const log = createLogger("reputation");

// ─── Agent Bootstrap ──────────────────────────────────────────

/**
 * Ensure all agent records exist in the database.
 * Called once at startup.
 */
export async function bootstrapAgents(): Promise<void> {
  const agentDefs: Array<{ name: string; type: AgentType; description: string }> = [
    {
      name: "Research Agent",
      type: "RESEARCH" as AgentType,
      description: "Web research, summarization, citation generation",
    },
    {
      name: "Data Agent",
      type: "DATA" as AgentType,
      description: "Structured data collection, scraping, dataset assembly",
    },
    {
      name: "Coding Agent",
      type: "CODING" as AgentType,
      description: "Code generation, testing, repository creation",
    },
    {
      name: "Verify Agent",
      type: "VERIFY" as AgentType,
      description: "Link verification, claim checking, web consistency checks",
    },
    {
      name: "Image Agent",
      type: "IMAGE" as AgentType,
      description: "Screenshot analysis, OCR, visual content extraction",
    },
  ];

  for (const def of agentDefs) {
    const existing = await prisma.agent.findUnique({
      where: { type: def.type },
    });

    if (!existing) {
      const agent = await prisma.agent.create({
        data: {
          name: def.name,
          type: def.type,
          description: def.description,
          isActive: true,
          reputation: {
            create: {
              categoryScores: {},
            },
          },
        },
      });
      log.info({ agentId: agent.id, type: def.type }, "Agent bootstrapped");
    }
  }
}

// ─── Reputation Update ────────────────────────────────────────

export interface OutcomeData {
  submissionId: string;
  bountyId: string;
  agentType: AgentType;
  outcome: SubmissionStatus;
  payoutAmount: number;
  computeCostActual: number;
  autoScore: number;
  taskType: TaskType;
}

/**
 * Update agent reputation after a submission outcome is known.
 * Called whenever Pump.fun GO approves or rejects a submission.
 */
export async function recordOutcome(data: OutcomeData): Promise<void> {
  const {
    submissionId,
    agentType,
    outcome,
    payoutAmount,
    computeCostActual,
    autoScore,
    taskType,
  } = data;

  log.info({ submissionId, agentType, outcome, payoutAmount }, "Recording outcome");

  const isApproved = outcome === "APPROVED";
  const isRejected = outcome === "REJECTED";
  const isExpired = outcome === "EXPIRED";

  // Get or create agent record
  const agent = await prisma.agent.findUnique({
    where: { type: agentType },
    include: { reputation: true },
  });

  if (!agent) {
    log.error({ agentType }, "Agent not found — run bootstrapAgents first");
    return;
  }

  if (!agent.reputation) {
    log.error({ agentType }, "Agent has no reputation record");
    return;
  }

  const rep = agent.reputation;
  const currentCategoryScores = (rep.categoryScores as unknown as Record<string, CategoryScore>) ?? {};

  // Update category score
  const catKey = taskType.toLowerCase();
  const currentCat = currentCategoryScores[catKey] ?? { attempted: 0, approved: 0, rate: 0 };
  const newAttempted = currentCat.attempted + 1;
  const newApproved = currentCat.approved + (isApproved ? 1 : 0);
  const newRate = newApproved / newAttempted;
  const updatedCategoryScores = {
    ...currentCategoryScores,
    [catKey]: {
      attempted: newAttempted,
      approved: newApproved,
      rate: newRate,
    } satisfies CategoryScore,
  };

  // Calculate new accuracy score (rolling weighted average)
  const newTotalSubmissions = rep.totalSubmissions + 1;
  const newApprovedTotal = rep.approved + (isApproved ? 1 : 0);
  const newAccuracyScore = newTotalSubmissions > 0
    ? newApprovedTotal / newTotalSubmissions
    : 0;

  // Rolling 30-day score (simplified: approximate with recent weighted average)
  const newRolling30d = rep.totalSubmissions < 5
    ? newAccuracyScore // Not enough data
    : rep.rolling30dScore * 0.85 + (isApproved ? 1 : 0) * 0.15;

  // Update avg auto-score
  const newAvgAutoScore = rep.totalSubmissions > 0
    ? (rep.avgAutoScore * rep.totalSubmissions + autoScore) / newTotalSubmissions
    : autoScore;

  await prisma.reputation.update({
    where: { agentId: agent.id },
    data: {
      totalSubmissions: { increment: 1 },
      totalBids: { increment: 0 }, // Incremented separately at bid time
      approved: isApproved ? { increment: 1 } : undefined,
      rejected: isRejected ? { increment: 1 } : undefined,
      expired: isExpired ? { increment: 1 } : undefined,
      totalEarnedUsd: isApproved ? { increment: payoutAmount } : undefined,
      totalComputeCost: { increment: computeCostActual },
      accuracyScore: newAccuracyScore,
      rolling30dScore: newRolling30d,
      avgAutoScore: newAvgAutoScore,
      categoryScores: updatedCategoryScores,
    },
  });

  // Update submission record with outcome
  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      outcome,
      outcomeAt: new Date(),
      payoutAmount: isApproved ? payoutAmount : 0,
    },
  });

  // Log event
  await prisma.event.create({
    data: {
      type: `REPUTATION_UPDATED`,
      bountyId: data.bountyId,
      submissionId,
      agentId: agent.id,
      severity: isApproved ? "INFO" : "WARN",
      message: `Outcome ${outcome}: agent ${agentType} accuracy now ${(newAccuracyScore * 100).toFixed(1)}%`,
      data: {
        outcome,
        payoutAmount,
        newAccuracyScore,
        newRolling30d,
        taskType,
        categoryRate: newRate,
      },
    },
  });

  log.info(
    {
      agentType,
      newAccuracyScore: newAccuracyScore.toFixed(3),
      newRolling30d: newRolling30d.toFixed(3),
      categoryRate: newRate.toFixed(3),
    },
    "Reputation updated"
  );
}

/**
 * Increment bid count when an agent decides to bid on a bounty.
 */
export async function recordBid(agentType: AgentType): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { type: agentType },
    select: { id: true },
  });

  if (!agent) return;

  await prisma.reputation.update({
    where: { agentId: agent.id },
    data: { totalBids: { increment: 1 } },
  });
}

// ─── Reputation Queries ───────────────────────────────────────

/**
 * Get the reputation stats for a specific agent type.
 * Used by the scorer to calibrate expected value.
 */
export async function getAgentStats(agentType: AgentType): Promise<AgentStats> {
  const agent = await prisma.agent.findUnique({
    where: { type: agentType },
    include: { reputation: true },
  });

  if (!agent?.reputation) {
    return {
      totalBids: 0,
      totalSubmissions: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      totalEarnedUsd: 0,
      totalComputeCost: 0,
      netProfitUsd: 0,
      accuracyScore: 0,
      rolling30dScore: 0,
      avgAutoScore: 0,
      categoryScores: {},
    };
  }

  const rep = agent.reputation;
  return {
    totalBids: rep.totalBids,
    totalSubmissions: rep.totalSubmissions,
    approved: rep.approved,
    rejected: rep.rejected,
    expired: rep.expired,
    totalEarnedUsd: rep.totalEarnedUsd,
    totalComputeCost: rep.totalComputeCost,
    netProfitUsd: rep.totalEarnedUsd - rep.totalComputeCost,
    accuracyScore: rep.accuracyScore,
    rolling30dScore: rep.rolling30dScore,
    avgAutoScore: rep.avgAutoScore,
    categoryScores: (rep.categoryScores as unknown as Record<string, CategoryScore>) ?? {},
  };
}

/**
 * Get category-specific accuracy for the scorer's win-rate model.
 */
export async function getCategoryAccuracy(
  agentType: AgentType,
  taskType: TaskType
): Promise<number> {
  const stats = await getAgentStats(agentType);
  const catKey = taskType.toLowerCase();
  return stats.categoryScores[catKey]?.rate ?? 0;
}

/**
 * Get system-wide metrics snapshot.
 */
export async function getSystemStats(): Promise<{
  agents: Record<string, AgentStats>;
  totalNetProfit: number;
  overallApprovalRate: number;
}> {
  const agentTypes: AgentType[] = [
    "RESEARCH" as AgentType,
    "DATA" as AgentType,
    "CODING" as AgentType,
    "VERIFY" as AgentType,
    "IMAGE" as AgentType,
  ];

  const agentStats: Record<string, AgentStats> = {};
  let totalApproved = 0;
  let totalSubmissions = 0;
  let totalNetProfit = 0;

  for (const type of agentTypes) {
    const stats = await getAgentStats(type);
    agentStats[type] = stats;
    totalApproved += stats.approved;
    totalSubmissions += stats.totalSubmissions;
    totalNetProfit += stats.netProfitUsd;
  }

  return {
    agents: agentStats,
    totalNetProfit,
    overallApprovalRate:
      totalSubmissions > 0 ? totalApproved / totalSubmissions : 0,
  };
}
