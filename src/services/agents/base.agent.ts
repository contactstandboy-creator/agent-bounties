import { prisma } from "@/lib/prisma";
import { anthropic, CLAUDE_MODELS, extractText, extractCost } from "@/lib/anthropic";
import { createLogger } from "@/lib/logger";
import type { AgentContext, AgentResult, ReviewResult } from "@/types";

const log = createLogger("base-agent");

// ─── Auto-Review System Prompt ────────────────────────────────

const REVIEW_SYSTEM_PROMPT = `You are a quality assurance reviewer for AI-generated bounty submissions.

Your job is to score a submission against the original bounty requirements and determine if it is good enough to be submitted to a human reviewer on Pump.fun GO.

Scoring criteria (each 0-100):
- accuracy: Is the information correct and factually grounded?
- completeness: Does it address all aspects of the bounty?
- citationQuality: Are sources real, relevant, and properly cited?
- verifiability: Can a human independently verify the key claims?
- conciseness: Is the answer clear and well-structured?

A submission passes auto-review if totalScore >= 75.

Respond with JSON only:
{
  "totalScore": 82,
  "breakdown": {
    "accuracy": 85,
    "completeness": 80,
    "citationQuality": 90,
    "verifiability": 75,
    "conciseness": 80
  },
  "passed": true,
  "reasoning": "The submission covers all key aspects with good sources...",
  "suggestions": ["Could include more recent data from 2026", "Source #3 could be more specific"]
}`;

// ─── Base Agent ───────────────────────────────────────────────

export abstract class BaseAgent {
  protected log = createLogger(this.name);

  constructor(protected readonly name: string) {}

  /**
   * Execute the agent for a given bounty context.
   * Must be implemented by each specialized agent.
   */
  abstract execute(context: AgentContext): Promise<AgentResult>;

  /**
   * Auto-review a submission before sending to Pump.fun GO.
   * Uses Claude Haiku for speed and cost efficiency.
   */
  async autoReview(
    context: AgentContext,
    result: AgentResult
  ): Promise<ReviewResult & { computeCost: number }> {
    this.log.info({ bountyId: context.bountyId }, "Running auto-review");

    const userMessage = `
## Bounty Requirements

**Title:** ${context.title}

**Description:**
${context.description}

**Reward:** $${context.rewardUsd}

## Submission to Review

${result.content}

**Sources:**
${result.sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n")}

Score this submission. Respond with JSON only.`.trim();

    const response = await anthropic.messages.create({
      model: CLAUDE_MODELS.HAIKU,
      max_tokens: 512,
      system: REVIEW_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const computeCost = extractCost(response);
    const text = extractText(response);

    const parsed = JSON.parse(
      text.replace(/```(?:json)?\n?/g, "").replace(/```\n?/g, "").trim()
    ) as ReviewResult;

    const review: ReviewResult & { computeCost: number } = {
      totalScore: Math.max(0, Math.min(100, parsed.totalScore ?? 0)),
      breakdown: parsed.breakdown ?? {
        accuracy: 0,
        completeness: 0,
        citationQuality: 0,
        verifiability: 0,
        conciseness: 0,
      },
      passed: (parsed.totalScore ?? 0) >= 75,
      reasoning: parsed.reasoning ?? "",
      suggestions: parsed.suggestions ?? [],
      computeCost,
    };

    this.log.info(
      { bountyId: context.bountyId, totalScore: review.totalScore, passed: review.passed },
      "Auto-review complete"
    );

    return review;
  }

  /**
   * Save submission to the database.
   */
  async saveSubmission(
    context: AgentContext,
    bidId: string,
    result: AgentResult,
    review: ReviewResult & { computeCost: number }
  ): Promise<string> {
    const submission = await prisma.submission.create({
      data: {
        bountyId: context.bountyId,
        bidId,
        agentType: context.classification.taskType as never, // Will be set correctly by worker
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

    await prisma.event.create({
      data: {
        type: review.passed ? "SUBMISSION_PASSED_REVIEW" : "SUBMISSION_FAILED_REVIEW",
        bountyId: context.bountyId,
        submissionId: submission.id,
        severity: review.passed ? "INFO" : "WARN",
        message: `Auto-review score: ${review.totalScore}/100 (${review.passed ? "PASS" : "FAIL"})`,
        data: {
          breakdown: review.breakdown,
          reasoning: review.reasoning,
          suggestions: review.suggestions,
        },
      },
    });

    return submission.id;
  }

  /**
   * Calculate total compute cost for all API calls made during execution.
   */
  protected sumCosts(costs: number[]): number {
    return costs.reduce((acc, c) => acc + c, 0);
  }

  /**
   * Truncate content to prevent excessively long submissions.
   */
  protected truncateContent(text: string, maxChars = 8_000): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 200) + "\n\n[Content truncated for length.]";
  }
}
