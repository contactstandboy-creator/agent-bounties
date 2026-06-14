import { createLogger } from "@/lib/logger";
import { config } from "@/lib/config";
import type { ScoringInput, ScoringResult } from "@/types";
import type { AgentType, BidDecision, TaskType } from "@prisma/client";

const log = createLogger("scorer");

// ─── Cost Model ───────────────────────────────────────────────

/**
 * Estimated compute cost in USD by task type.
 * Includes API calls, LLM tokens, and search API.
 */
const COMPUTE_COST_BY_TYPE: Record<TaskType, number> = {
  RESEARCH: 0.35,         // Search + Claude Sonnet synthesis
  DATA_COLLECTION: 0.25,  // Scraping + structured extraction
  WEB_VERIFICATION: 0.15, // Fetch + Claude Haiku check
  CODING: 0.45,           // Claude Sonnet code gen + test
  IMAGE_ANALYSIS: 0.20,   // Claude Haiku vision
  SOCIAL_MEDIA: 0.05,
  LOCAL_PHYSICAL: 0.01,
  PHONE_CALL: 0.01,
  IMPOSSIBLE: 0.01,
};

// ─── Win Rate Model ───────────────────────────────────────────

/**
 * Base win rate by task type.
 * These represent our prior probability of having our submission accepted
 * by Pump.fun GO's human reviewers.
 *
 * Values calibrated conservatively. Will be updated as reputation data
 * accumulates via the learning loop.
 */
const BASE_WIN_RATE_BY_TYPE: Record<TaskType, number> = {
  RESEARCH: 0.55,          // Good at research, but so are humans
  DATA_COLLECTION: 0.65,   // Agents excel at structured data
  WEB_VERIFICATION: 0.70,  // Clear, verifiable output
  CODING: 0.60,            // Code is testable = higher acceptance
  IMAGE_ANALYSIS: 0.50,    // Hit or miss depending on screenshot quality
  SOCIAL_MEDIA: 0.10,      // Needs human X account
  LOCAL_PHYSICAL: 0.00,
  PHONE_CALL: 0.00,
  IMPOSSIBLE: 0.00,
};

/**
 * Pump.fun GO platform rejection risk (they might reject even good work).
 * Based on observed early behavior: ~15% of valid submissions get rejected
 * due to moderation issues, unclear criteria, or reviewer bias.
 */
const PLATFORM_REJECTION_RATE = 0.15;

// ─── Competition Estimator ────────────────────────────────────

/**
 * Estimate number of competing submissions.
 * Higher reward = more competition.
 */
function estimateCompetition(rewardUsd: number): number {
  if (rewardUsd >= 500) return 25;
  if (rewardUsd >= 100) return 15;
  if (rewardUsd >= 50) return 10;
  if (rewardUsd >= 20) return 6;
  return 3;
}

/**
 * Our win probability given estimated competition.
 * Assumes our submission quality is above average but not guaranteed best.
 */
function winProbabilityGivenCompetition(
  competitorCount: number,
  qualityMultiplier: number
): number {
  // If we're one of N competitors, our raw chance is 1/N.
  // Quality multiplier boosts this (>1 = better than average).
  const rawChance = 1 / competitorCount;
  const adjusted = rawChance * qualityMultiplier;
  return Math.min(adjusted, 0.90); // Cap at 90%
}

// ─── Risk Model ───────────────────────────────────────────────

function calculateRiskPenalty(
  rewardUsd: number,
  confidence: number,
  categoryAccuracy: number
): number {
  // Penalty for uncertainty in classification
  const confidencePenalty = (1 - confidence) * rewardUsd * 0.10;
  // Penalty for poor historical performance in this category
  const accuracyPenalty = Math.max(0, (0.70 - categoryAccuracy)) * rewardUsd * 0.15;
  return confidencePenalty + accuracyPenalty;
}

// ─── Main Scoring Function ────────────────────────────────────

/**
 * Determine whether to bid on a bounty and calculate expected value.
 *
 * EV = reward × estimatedWinRate × (1 - platformRejectionRate) - computeCost - riskPenalty
 */
export function scoreBounty(input: ScoringInput): ScoringResult {
  const {
    bountyId,
    rewardUsd,
    taskType,
    confidence,
    categoryAccuracy,
    rolling30dScore,
    competitionEstimate,
  } = input;

  log.debug({ bountyId, rewardUsd, taskType, confidence }, "Scoring bounty");

  // 1. Check if task is possible at all
  if (["LOCAL_PHYSICAL", "PHONE_CALL", "IMPOSSIBLE", "SOCIAL_MEDIA"].includes(taskType)) {
    return {
      decision: "REJECTED_IMPOSSIBLE" as BidDecision,
      expectedValue: 0,
      estimatedWinRate: 0,
      computeCostEst: 0,
      riskPenalty: 0,
      confidenceScore: 0,
      reasoning: `Task type ${taskType} cannot be completed by an AI agent.`,
    };
  }

  // 2. Confidence gate
  if (confidence < config.MIN_CONFIDENCE_THRESHOLD) {
    return {
      decision: "REJECTED_LOW_CONFIDENCE" as BidDecision,
      expectedValue: 0,
      estimatedWinRate: 0,
      computeCostEst: COMPUTE_COST_BY_TYPE[taskType] ?? 0.30,
      riskPenalty: 0,
      confidenceScore: confidence,
      reasoning: `Classification confidence ${(confidence * 100).toFixed(1)}% is below threshold of ${(config.MIN_CONFIDENCE_THRESHOLD * 100).toFixed(1)}%.`,
    };
  }

  // 3. Calculate win rate
  const baseWinRate = BASE_WIN_RATE_BY_TYPE[taskType] ?? 0.30;

  // Adjust win rate based on our reputation in this category
  const reputationMultiplier = categoryAccuracy > 0
    ? 0.7 + (categoryAccuracy * 0.6) // Range: 0.7 to 1.3
    : 1.0; // No data = neutral

  // Adjust for 30-day rolling performance
  const rollingMultiplier = rolling30dScore > 0
    ? 0.8 + (rolling30dScore * 0.4) // Range: 0.8 to 1.2
    : 1.0;

  // Adjust for competition
  const competition = competitionEstimate > 0
    ? competitionEstimate
    : estimateCompetition(rewardUsd);
  const competitionWinRate = winProbabilityGivenCompetition(
    competition,
    reputationMultiplier * rollingMultiplier
  );

  // Final win rate: blend base rate with competition model
  const estimatedWinRate = Math.min(
    (baseWinRate * 0.4 + competitionWinRate * 0.6) *
    (1 - PLATFORM_REJECTION_RATE),
    0.85
  );

  // 4. Compute costs
  const computeCostEst = COMPUTE_COST_BY_TYPE[taskType] ?? 0.30;

  // 5. Risk penalty
  const riskPenalty = calculateRiskPenalty(rewardUsd, confidence, categoryAccuracy);

  // 6. Expected value
  const expectedValue =
    rewardUsd * estimatedWinRate - computeCostEst - riskPenalty;

  // 7. Confidence score (0-1 composite)
  const confidenceScore = Math.min(
    confidence * 0.5 + estimatedWinRate * 0.5,
    1.0
  );

  // 8. Decision
  const decision: BidDecision =
    expectedValue >= config.MIN_EV_THRESHOLD
      ? "ACCEPTED"
      : "REJECTED_LOW_EV";

  const reasoning = buildReasoning({
    taskType,
    rewardUsd,
    baseWinRate,
    estimatedWinRate,
    competition,
    computeCostEst,
    riskPenalty,
    expectedValue,
    confidence,
    categoryAccuracy,
    decision,
  });

  log.info(
    { bountyId, decision, expectedValue: expectedValue.toFixed(3), estimatedWinRate: estimatedWinRate.toFixed(3) },
    "Scoring complete"
  );

  return {
    decision,
    expectedValue,
    estimatedWinRate,
    computeCostEst,
    riskPenalty,
    confidenceScore,
    reasoning,
  };
}

function buildReasoning(params: {
  taskType: string;
  rewardUsd: number;
  baseWinRate: number;
  estimatedWinRate: number;
  competition: number;
  computeCostEst: number;
  riskPenalty: number;
  expectedValue: number;
  confidence: number;
  categoryAccuracy: number;
  decision: BidDecision;
}): string {
  const {
    taskType,
    rewardUsd,
    baseWinRate,
    estimatedWinRate,
    competition,
    computeCostEst,
    riskPenalty,
    expectedValue,
    confidence,
    categoryAccuracy,
    decision,
  } = params;

  const lines = [
    `Task: ${taskType} | Reward: $${rewardUsd.toFixed(2)}`,
    `Classification confidence: ${(confidence * 100).toFixed(1)}%`,
    `Base win rate for ${taskType}: ${(baseWinRate * 100).toFixed(1)}%`,
    `Estimated competition: ~${competition} submissions`,
    `Historical category accuracy: ${categoryAccuracy > 0 ? (categoryAccuracy * 100).toFixed(1) + "%" : "no data"}`,
    `Adjusted win rate: ${(estimatedWinRate * 100).toFixed(1)}%`,
    `Estimated compute cost: $${computeCostEst.toFixed(3)}`,
    `Risk penalty: $${riskPenalty.toFixed(3)}`,
    `Expected value: $${expectedValue.toFixed(3)}`,
    `Decision: ${decision} (threshold: $${config.MIN_EV_THRESHOLD.toFixed(2)})`,
  ];

  return lines.join(" | ");
}

// ─── Agent Type Selector ──────────────────────────────────────

/**
 * Select the best agent type for a given task type.
 */
export function selectAgentType(taskType: TaskType): AgentType {
  const mapping: Partial<Record<TaskType, AgentType>> = {
    RESEARCH: "RESEARCH" as AgentType,
    DATA_COLLECTION: "DATA" as AgentType,
    CODING: "CODING" as AgentType,
    WEB_VERIFICATION: "VERIFY" as AgentType,
    IMAGE_ANALYSIS: "IMAGE" as AgentType,
  };

  return mapping[taskType] ?? ("RESEARCH" as AgentType);
}
