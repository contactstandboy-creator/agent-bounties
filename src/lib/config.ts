import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string(),

  // AI
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),
  OPENAI_API_KEY: z.string().startsWith("sk-"),

  // Search
  BRAVE_SEARCH_API_KEY: z.string().optional(),

  // Pump.fun GO
  PUMPFUN_GO_BASE_URL: z.string().url().default("https://go.pump.fun"),
  PUMPFUN_GO_API_URL: z.string().url().default("https://api.go.pump.fun"),

  // Agent thresholds
  MIN_EV_THRESHOLD: z.coerce.number().default(2.0),
  MIN_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.70),
  TARGET_APPROVAL_RATE: z.coerce.number().min(0).max(1).default(0.80),

  // Indexer
  INDEXER_POLL_INTERVAL: z.coerce.number().default(60),

  // App
  ADMIN_SECRET: z.string().default("admin-secret-token"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    const missing = Object.entries(errors)
      .map(([k, v]) => `  ${k}: ${v?.join(", ")}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${missing}`);
  }

  return parsed.data;
}

// Validate once at module load; cached for the process lifetime.
export const config = validateEnv();

export type Config = z.infer<typeof envSchema>;
