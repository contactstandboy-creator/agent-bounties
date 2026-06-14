import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { enqueueClassify } from "@/lib/queues";
import { createLogger } from "@/lib/logger";
import { config } from "@/lib/config";
import { fetchActiveBounties } from "./pumpfun.scraper";
import type { RawBounty, NormalizedBounty } from "@/types";

const log = createLogger("indexer");

const SEEN_KEY = "indexer:seen_ids";
const SEEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ─── Normalization ────────────────────────────────────────────

function normalizeBounty(raw: RawBounty): NormalizedBounty {
  return {
    ...raw,
    externalId: raw.id,
    title: raw.title.trim().replace(/\s+/g, " "),
    description: raw.description.trim(),
    rewardUsd: Math.round(raw.rewardUsd * 100) / 100,
  };
}

function isValidBounty(bounty: NormalizedBounty): boolean {
  if (!bounty.externalId || bounty.externalId.length < 2) return false;
  if (!bounty.title || bounty.title.length < 3) return false;
  if (!bounty.description || bounty.description.length < 10) return false;
  if (bounty.rewardUsd < 1) return false; // Skip < $1 bounties
  if (bounty.rewardUsd > 1_000_000) return false; // Skip unrealistic rewards

  // Skip obviously spammy titles
  const spamPatterns = [/test\s+bounty/i, /^test$/i, /lorem ipsum/i];
  if (spamPatterns.some((p) => p.test(bounty.title))) return false;

  return true;
}

// ─── Deduplication ────────────────────────────────────────────

async function isAlreadySeen(externalId: string): Promise<boolean> {
  const member = await redis.sismember(SEEN_KEY, externalId);
  return member === 1;
}

async function markAsSeen(externalIds: string[]): Promise<void> {
  if (externalIds.length === 0) return;
  const pipeline = redis.pipeline();
  for (const id of externalIds) {
    pipeline.sadd(SEEN_KEY, id);
  }
  pipeline.expire(SEEN_KEY, SEEN_TTL_SECONDS);
  await pipeline.exec();
}

// ─── Database Upsert ──────────────────────────────────────────

async function upsertBounty(bounty: NormalizedBounty): Promise<{
  isNew: boolean;
  dbId: string;
}> {
  const existing = await prisma.bounty.findUnique({
    where: { externalId: bounty.externalId },
    select: { id: true },
  });

  if (existing) {
    // Update reward/status if changed
    await prisma.bounty.update({
      where: { id: existing.id },
      data: {
        rewardUsd: bounty.rewardUsd,
        status: "ACTIVE",
        updatedAt: new Date(),
      },
    });
    return { isNew: false, dbId: existing.id };
  }

  const created = await prisma.bounty.create({
    data: {
      externalId: bounty.externalId,
      title: bounty.title,
      description: bounty.description,
      rewardUsd: bounty.rewardUsd,
      rewardSol: bounty.rewardSol,
      deadline: bounty.deadline ? new Date(bounty.deadline) : null,
      creatorAddress: bounty.creatorAddress,
      creatorTwitter: bounty.creatorTwitter,
      url: bounty.url,
      rawData: bounty.rawData ?? {},
      status: "ACTIVE",
    },
    select: { id: true },
  });

  return { isNew: true, dbId: created.id };
}

// ─── Log Event ────────────────────────────────────────────────

async function logEvent(
  type: string,
  message: string,
  bountyId?: string,
  data?: Record<string, unknown>
): Promise<void> {
  await prisma.event.create({
    data: {
      type,
      message,
      bountyId,
      severity: "INFO",
      data: data ?? {},
    },
  });
}

// ─── Main Index Run ───────────────────────────────────────────

export interface IndexRunResult {
  fetched: number;
  valid: number;
  newBounties: number;
  enqueued: number;
  skipped: number;
  method: string;
  durationMs: number;
  errors: string[];
}

export async function runIndexerCycle(): Promise<IndexRunResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  log.info("Starting indexer cycle");

  const result: IndexRunResult = {
    fetched: 0,
    valid: 0,
    newBounties: 0,
    enqueued: 0,
    skipped: 0,
    method: "none",
    durationMs: 0,
    errors: [],
  };

  // 1. Fetch from Pump.fun GO
  const { bounties: rawBounties, method, error } = await fetchActiveBounties();
  result.method = method;
  result.fetched = rawBounties.length;

  if (error) {
    errors.push(error);
    log.warn({ error }, "Fetch returned error");
  }

  // 2. Normalize and validate
  const normalized = rawBounties
    .map(normalizeBounty)
    .filter(isValidBounty);
  result.valid = normalized.length;

  log.info(
    { fetched: result.fetched, valid: result.valid, method },
    "Bounties fetched and validated"
  );

  // 3. Process each bounty
  for (const bounty of normalized) {
    try {
      // Fast Redis dedup check
      const seen = await isAlreadySeen(bounty.externalId);
      if (seen) {
        result.skipped++;
        continue;
      }

      // Upsert to DB
      const { isNew, dbId } = await upsertBounty(bounty);

      if (isNew) {
        result.newBounties++;

        // Enqueue for classification
        await enqueueClassify({
          bountyId: dbId,
          title: bounty.title,
          description: bounty.description,
          rewardUsd: bounty.rewardUsd,
        });

        result.enqueued++;

        await logEvent(
          "BOUNTY_INDEXED",
          `New bounty indexed: ${bounty.title}`,
          dbId,
          { externalId: bounty.externalId, rewardUsd: bounty.rewardUsd }
        );

        log.info(
          { dbId, externalId: bounty.externalId, title: bounty.title, rewardUsd: bounty.rewardUsd },
          "New bounty indexed and enqueued"
        );
      } else {
        result.skipped++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Error processing ${bounty.externalId}: ${msg}`);
      log.error({ err, externalId: bounty.externalId }, "Error processing bounty");
    }
  }

  // 4. Mark all as seen in Redis
  const ids = normalized.map((b) => b.externalId);
  await markAsSeen(ids);

  // 5. Record metrics
  result.durationMs = Date.now() - startTime;
  result.errors = errors;

  await prisma.systemMetric.create({
    data: {
      name: "indexer.cycle",
      value: result.newBounties,
      labels: {
        method,
        fetched: result.fetched,
        valid: result.valid,
        enqueued: result.enqueued,
        durationMs: result.durationMs,
      },
    },
  });

  log.info(result, "Indexer cycle complete");
  return result;
}

// ─── Standalone Runner ────────────────────────────────────────

/**
 * Run the indexer on an interval.
 * Invoked via `npm run indexer:run` or as part of the worker process.
 */
export async function startIndexerLoop(): Promise<never> {
  log.info(
    { pollIntervalSecs: config.INDEXER_POLL_INTERVAL },
    "Starting indexer loop"
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runIndexerCycle();
    } catch (err) {
      log.error({ err }, "Indexer cycle failed");
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.INDEXER_POLL_INTERVAL * 1000)
    );
  }
}

// Allow running directly: tsx src/services/indexer/indexer.service.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  log.info("Running indexer directly");
  startIndexerLoop().catch((err) => {
    log.fatal({ err }, "Indexer crashed");
    process.exit(1);
  });
}
