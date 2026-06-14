/**
 * Seed script for development.
 * Creates sample bounties to test the full pipeline without scraping Pump.fun GO.
 *
 * Run: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SAMPLE_BOUNTIES = [
  {
    externalId: "seed-001",
    title: "Research top 10 DeFi protocols by TVL on Solana",
    description:
      "I need a comprehensive table of the top 10 DeFi protocols on Solana ranked by Total Value Locked (TVL). Include: protocol name, TVL in USD, main product type (AMM, lending, etc.), fees (daily/weekly), and website URL. Data should be as of this week. Deliverable: a clear formatted table ready to share.",
    rewardUsd: 25,
    url: "https://go.pump.fun/bounty/seed-001",
    status: "ACTIVE",
    rawData: {},
  },
  {
    externalId: "seed-002",
    title: "Write a Python script to fetch and parse Pump.fun GO bounties",
    description:
      "I need a Python script that: 1) Fetches active bounties from go.pump.fun via API or scraping, 2) Parses each bounty into a JSON format with: id, title, description, reward_usd, deadline, 3) Saves output to bounties.json, 4) Handles errors gracefully. Deliverable: working .py file with README.",
    rewardUsd: 50,
    url: "https://go.pump.fun/bounty/seed-002",
    status: "ACTIVE",
    rawData: {},
  },
  {
    externalId: "seed-003",
    title: "Verify whether these 5 crypto projects are still active in 2026",
    description:
      "Please verify if these projects are still active as of 2026: 1) Mango Markets, 2) Raydium, 3) Marinade Finance, 4) Orca, 5) Drift Protocol. For each: check if website works, check if social media is active (last post date), check if there's been any recent on-chain activity. Deliverable: a table with current status for each.",
    rewardUsd: 15,
    url: "https://go.pump.fun/bounty/seed-003",
    status: "ACTIVE",
    rawData: {},
  },
  {
    externalId: "seed-004",
    title: "Call my dentist and reschedule my appointment",
    description:
      "I need someone to call Dr. Smith's office at (555) 123-4567 and reschedule my appointment from Tuesday to Thursday at 2pm. Just say you're calling on behalf of John.",
    rewardUsd: 10,
    url: "https://go.pump.fun/bounty/seed-004",
    status: "ACTIVE",
    rawData: {},
  },
  {
    externalId: "seed-005",
    title: "Collect the current token prices for top 20 Solana memecoins",
    description:
      "I need a dataset of the current prices for the top 20 memecoins on Solana by market cap. For each token include: name, symbol, contract address, current price USD, 24h change %, market cap, and where to trade. Format as CSV. Data should be live/current.",
    rewardUsd: 30,
    url: "https://go.pump.fun/bounty/seed-005",
    status: "ACTIVE",
    rawData: {},
  },
];

async function main() {
  console.log("🌱 Seeding database...");

  for (const bounty of SAMPLE_BOUNTIES) {
    const existing = await prisma.bounty.findUnique({
      where: { externalId: bounty.externalId },
    });

    if (existing) {
      console.log(`  ⏭️  Skipping ${bounty.externalId} (already exists)`);
      continue;
    }

    await prisma.bounty.create({ data: bounty as Parameters<typeof prisma.bounty.create>[0]["data"] });
    console.log(`  ✅  Created bounty: ${bounty.title.slice(0, 50)}`);
  }

  console.log("\n✨ Seed complete. Run `npm run workers` to process these bounties.");
}

main()
  .catch(console.error)
  .finally(() => void prisma.$disconnect());
