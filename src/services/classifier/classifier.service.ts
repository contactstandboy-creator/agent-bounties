import { anthropic, CLAUDE_MODELS, extractText, parseJsonResponse, extractCost } from "@/lib/anthropic";
import { createLogger } from "@/lib/logger";
import {
  AI_DOABLE_TASK_TYPES,
  type ClassificationResult,
} from "@/types";

const log = createLogger("classifier");

// ─── System Prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI task classifier for an agent bounty system.

Your job is to analyze bounty descriptions from Pump.fun GO — a platform where people post tasks for cash rewards — and determine whether an AI agent can complete them autonomously.

## Task Types

Classify each bounty into exactly ONE of these categories:

- RESEARCH: Web research, data gathering, summarization, market analysis, competitor research, writing reports
- DATA_COLLECTION: Scraping structured data, building lists, compiling datasets, price tracking
- WEB_VERIFICATION: Checking if links work, verifying claims online, confirming information exists on the web
- SOCIAL_MEDIA: Twitter/X posts, engagement tasks, social media monitoring (requires X account — flag this)
- CODING: Writing code, creating scripts, building tools, fixing bugs, creating repos
- IMAGE_ANALYSIS: Analyzing screenshots, extracting text from images, describing images, OCR
- LOCAL_PHYSICAL: Tasks requiring physical presence, in-person activities, real-world actions
- PHONE_CALL: Tasks requiring phone/voice calls, phone verification, IVR interaction
- IMPOSSIBLE: Tasks that are ambiguous, illegal, impossible to verify, require deception, or have no clear deliverable

## AI Capability Assessment

An AI agent CAN do: RESEARCH, DATA_COLLECTION, WEB_VERIFICATION, CODING, IMAGE_ANALYSIS
An AI agent CANNOT do: LOCAL_PHYSICAL, PHONE_CALL
An AI agent SHOULD NOT do: SOCIAL_MEDIA (requires human X account auth)
An AI agent CANNOT do: IMPOSSIBLE tasks

## Confidence Scoring

- 0.90-1.0: Crystal clear task with well-defined deliverables
- 0.70-0.89: Clear task, minor ambiguity in deliverables
- 0.50-0.69: Moderately clear, some interpretation required
- 0.30-0.49: Ambiguous, multiple valid interpretations
- 0.00-0.29: Very unclear or possibly deceptive

## Response Format

Always respond with valid JSON only, no markdown:

{
  "taskType": "RESEARCH",
  "confidence": 0.87,
  "reasoning": "The bounty asks for competitor research which an AI can execute by...",
  "isAiDoable": true,
  "estimatedTimeMinutes": 15,
  "requiredTools": ["web_search", "content_extraction"],
  "subTasks": ["Search for top 10 competitors", "Compile pricing data", "Write summary report"]
}`;

// ─── Classification Logic ─────────────────────────────────────

export interface ClassificationInput {
  bountyId: string;
  title: string;
  description: string;
  rewardUsd: number;
}

export async function classifyBounty(
  input: ClassificationInput
): Promise<ClassificationResult & { computeCost: number }> {
  const { bountyId, title, description, rewardUsd } = input;

  log.info({ bountyId, title, rewardUsd }, "Classifying bounty");

  const userMessage = `
Bounty Title: ${title}

Bounty Description:
${description}

Reward: $${rewardUsd} USD

Classify this bounty. Respond with JSON only.`.trim();

  const response = await anthropic.messages.create({
    model: CLAUDE_MODELS.HAIKU,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const computeCost = extractCost(response);
  const text = extractText(response);

  log.debug({ bountyId, rawResponse: text }, "Raw classification response");

  const parsed = parseJsonResponse<{
    taskType: string;
    confidence: number;
    reasoning: string;
    isAiDoable: boolean;
    estimatedTimeMinutes: number;
    requiredTools: string[];
    subTasks?: string[];
  }>(text);

  // Validate task type
  const validTaskTypes = [
    "RESEARCH", "DATA_COLLECTION", "WEB_VERIFICATION", "SOCIAL_MEDIA",
    "CODING", "IMAGE_ANALYSIS", "LOCAL_PHYSICAL", "PHONE_CALL", "IMPOSSIBLE",
  ] as const;

  const taskType = validTaskTypes.includes(parsed.taskType as typeof validTaskTypes[number])
    ? (parsed.taskType as (typeof validTaskTypes)[number])
    : "IMPOSSIBLE";

  // Override isAiDoable based on task type (don't trust model's self-assessment blindly)
  const isAiDoable = AI_DOABLE_TASK_TYPES.includes(taskType as typeof AI_DOABLE_TASK_TYPES[number]);

  const result: ClassificationResult & { computeCost: number } = {
    taskType,
    confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0)),
    reasoning: parsed.reasoning ?? "No reasoning provided",
    isAiDoable,
    estimatedTimeMinutes: parsed.estimatedTimeMinutes ?? 30,
    requiredTools: Array.isArray(parsed.requiredTools) ? parsed.requiredTools : [],
    subTasks: parsed.subTasks,
    rawResponse: { text, usage: response.usage },
    computeCost,
  };

  log.info(
    { bountyId, taskType, confidence: result.confidence, isAiDoable, computeCost },
    "Classification complete"
  );

  return result;
}

// ─── Batch Classification (for backfill) ─────────────────────

export async function classifyBounties(
  inputs: ClassificationInput[],
  delayMs = 200
): Promise<Map<string, ClassificationResult & { computeCost: number }>> {
  const results = new Map<string, ClassificationResult & { computeCost: number }>();

  for (const input of inputs) {
    try {
      const result = await classifyBounty(input);
      results.set(input.bountyId, result);

      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (err) {
      log.error({ err, bountyId: input.bountyId }, "Classification failed");
    }
  }

  return results;
}
