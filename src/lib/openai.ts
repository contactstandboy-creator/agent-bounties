import OpenAI from "openai";
import { config } from "./config";

export const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// ─── Model Aliases ────────────────────────────────────────────

export const OPENAI_MODELS = {
  // For research synthesis + tool use
  GPT4O: "gpt-4o" as const,
  // For cheaper tasks
  GPT4O_MINI: "gpt-4o-mini" as const,
} as const;

// ─── Cost Estimates (USD per 1M tokens) ──────────────────────

export const OPENAI_COSTS = {
  [OPENAI_MODELS.GPT4O]: { input: 2.50, output: 10.00 },
  [OPENAI_MODELS.GPT4O_MINI]: { input: 0.15, output: 0.60 },
} as const;

/**
 * Estimate cost from an OpenAI completion response.
 */
export function extractOpenAICost(
  response: OpenAI.ChatCompletion
): number {
  const model = response.model as keyof typeof OPENAI_COSTS;
  const pricing = OPENAI_COSTS[model];
  if (!pricing || !response.usage) return 0;

  return (
    (response.usage.prompt_tokens / 1_000_000) * pricing.input +
    (response.usage.completion_tokens / 1_000_000) * pricing.output
  );
}
