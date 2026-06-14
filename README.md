# Agent Bounties — Phase 1

> AI agents that autonomously discover, evaluate, complete, and submit Pump.fun GO bounties.

## Architecture

```
Pump.fun GO
    ↓  (poll every 60s)
Bounty Indexer  →  PostgreSQL
    ↓  (BullMQ)
Classification Agent  →  Claude Haiku  →  9 task types
    ↓  (if AI-doable)
Opportunity Scorer  →  EV = reward × win_rate − cost − risk
    ↓  (if EV > $2.00)
Research Agent  →  Brave Search + Claude Sonnet
    ↓
Auto-Reviewer  →  Score 0–100, gate at 75
    ↓  (if passed)
→ Ready to submit to Pump.fun GO
    ↓  (after outcome)
Reputation Engine  →  calibrate future bids
```

## Quick Start

### 1. Prerequisites

- Node.js 20+
- Docker (for Postgres + Redis)
- API keys: Anthropic, OpenAI, Brave Search (optional)

### 2. Setup

```bash
# Clone and install
git clone https://github.com/your-org/agent-bounties
cd agent-bounties
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your API keys

# Start infrastructure
docker compose up -d

# Generate Prisma client and push schema
npm run db:generate
npm run db:push

# Seed development bounties
npm run db:seed
```

### 3. Run

**Terminal 1 — Next.js web app:**
```bash
npm run dev
# Open http://localhost:3000/admin
```

**Terminal 2 — Workers + Indexer:**
```bash
npm run workers
```

The worker process will:
1. Bootstrap agent records in the DB
2. Start all 4 BullMQ workers (classify, score, research, reputation)
3. Start the indexer loop (polls Pump.fun GO every 60 seconds)

## Development

### Trigger indexer manually (without waiting 60s)

```bash
curl -X POST http://localhost:3000/api/webhooks/trigger-index \
  -H "Authorization: Bearer admin-secret-token"
```

### View queue state
```bash
# Queue depths via API
curl http://localhost:3000/api/metrics | jq .data.queues

# Prisma Studio
npm run db:studio
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key (classification, synthesis, review) |
| `OPENAI_API_KEY` | ✅ | OpenAI key (fallback synthesis) |
| `BRAVE_SEARCH_API_KEY` | ❌ | Brave Search (falls back to DuckDuckGo) |
| `MIN_EV_THRESHOLD` | ❌ | Min expected value to bid (default: $2.00) |
| `MIN_CONFIDENCE_THRESHOLD` | ❌ | Min classification confidence (default: 0.70) |
| `INDEXER_POLL_INTERVAL` | ❌ | Seconds between polls (default: 60) |

## Project Structure

```
agent-bounties/
├── prisma/
│   ├── schema.prisma       # Database schema
│   └── seed.ts             # Dev seed data
├── src/
│   ├── types/index.ts      # Shared TypeScript types
│   ├── lib/
│   │   ├── config.ts       # Env validation (Zod)
│   │   ├── logger.ts       # Pino structured logger
│   │   ├── prisma.ts       # Prisma singleton
│   │   ├── redis.ts        # IORedis singleton
│   │   ├── queues.ts       # BullMQ queue definitions
│   │   ├── anthropic.ts    # Claude client + helpers
│   │   └── openai.ts       # OpenAI client + helpers
│   ├── services/
│   │   ├── indexer/
│   │   │   ├── pumpfun.scraper.ts   # Pump.fun GO fetcher
│   │   │   └── indexer.service.ts   # Poll + dedup + dispatch
│   │   ├── classifier/
│   │   │   └── classifier.service.ts  # Claude Haiku classification
│   │   ├── scorer/
│   │   │   └── scorer.service.ts      # EV calculation
│   │   ├── agents/
│   │   │   ├── base.agent.ts          # Abstract base + auto-review
│   │   │   └── research.agent.ts      # Web search + synthesis
│   │   └── reputation/
│   │       └── reputation.service.ts  # Track outcomes + calibrate
│   ├── workers/
│   │   ├── classify.worker.ts
│   │   ├── score.worker.ts
│   │   ├── research.worker.ts
│   │   ├── reputation.worker.ts
│   │   └── runner.ts              # Starts all workers
│   └── app/                       # Next.js App Router
│       ├── admin/page.tsx         # Dashboard
│       ├── admin/bounties/page.tsx
│       ├── admin/agents/page.tsx
│       └── api/                   # REST API
```

## AI Model Usage

| Service | Model | Why |
|---|---|---|
| Classification | Claude Haiku | Fast, cheap, great structured output |
| Query Generation | Claude Haiku | Simple task, speed matters |
| Research Synthesis | Claude Sonnet | Best at nuanced synthesis and citation |
| Auto-Review | Claude Haiku | Fast quality gate before submission |

## Phase 2 Roadmap

- [ ] Automated submission to go.pump.fun (Playwright or API)
- [ ] Coding agent (Claude Sonnet + code execution sandbox)
- [ ] Image/vision agent (Claude Vision for screenshot analysis)
- [ ] Outcome polling (periodically check submission status on Pump.fun GO)
- [ ] Staking system (token-based stake for submission credibility)
- [ ] Multi-agent competition (run multiple agents, pick best)
- [ ] Horizontal worker scaling (separate containers per agent type)
