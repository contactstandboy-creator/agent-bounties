import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

export const anthropic = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});

// ─── Model Aliases ────────────────────────────────────────────

export const CLAUDE_MODELS = {
  // Fast & cheap: classification, auto-review, simple extraction
  HAIKU: "claude-haiku-4-5-20251001" as const,
  // Smart & capable: research synthesis, complex reasoning
  SONNET: "claude-sonnet-4-6" as const,
} as const;

// ─── Cost Estimates (USD per 1M tokens) ──────────────────────

export const CLAUDE_COSTS = {
  [CLAUDE_MODELS.HAIKU]: { input: 0.80, output: 4.00 },
  [CLAUDE_MODELS.SONNET]: { input: 3.00, output: 15.00 },
} as const;

/**
 * Estimate USD cost for a Claude call.
 */
export function estimateClaudeCost(
  model: keyof typeof CLAUDE_COSTS,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = CLAUDE_COSTS[model];
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Extract usage cost from a Claude response message.
 */
export function extractCost(
  response: Anthropic.Message
): number {
  const model = response.model as keyof typeof CLAUDE_COSTS;
  const pricing = CLAUDE_COSTS[model];
  if (!pricing) return 0;

  return (
    (response.usage.input_tokens / 1_000_000) * pricing.input +
    (response.usage.output_tokens / 1_000_000) * pricing.output
  );
}

/**
 * Extract the text content from a Claude message.
 */
export function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Parse JSON from Claude's response, handling markdown code fences.
 */
export function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .replace(/```(?:json)?\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Find first { or [ and parse from there
    const jsonStart = cleaned.search(/[{[]/);
    if (jsonStart === -1) {
      throw new Error(`No JSON found in response: ${cleaned.slice(0, 200)}`);
    }
    return JSON.parse(cleaned.slice(jsonStart)) as T;
  }
}
