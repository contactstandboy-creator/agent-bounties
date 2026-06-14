import type { TaskType, BidDecision, AgentType, SubmissionStatus } from "@prisma/client";

// ─── Bounty Types ─────────────────────────────────────────────

export interface RawBounty {
  id: string;
  title: string;
  description: string;
  rewardUsd: number;
  rewardSol?: number;
  deadline?: string;
  creatorAddress?: string;
  creatorTwitter?: string;
  url: string;
  rawData?: Record<string, unknown>;
}

export interface NormalizedBounty extends RawBounty {
  externalId: string;
}

// ─── Classification Types ─────────────────────────────────────

export interface ClassificationResult {
  taskType: TaskType;
  confidence: number;
  reasoning: string;
  isAiDoable: boolean;
  estimatedTimeMinutes: number;
  requiredTools: string[];
  subTasks?: string[];
  rawResponse?: Record<string, unknown>;
}

export const AI_DOABLE_TASK_TYPES: TaskType[] = [
  "RESEARCH",
  "DATA_COLLECTION",
  "WEB_VERIFICATION",
  "CODING",
  "IMAGE_ANALYSIS",
];

export const AI_IMPOSSIBLE_TASK_TYPES: TaskType[] = [
  "LOCAL_PHYSICAL",
  "PHONE_CALL",
  "IMPOSSIBLE",
];

// ─── Scoring Types ────────────────────────────────────────────

export interface ScoringInput {
  bountyId: string;
  rewardUsd: number;
  taskType: TaskType;
  confidence: number;
  agentType: AgentType;
  categoryAccuracy: number;
  rolling30dScore: number;
  competitionEstimate: number;
}

export interface ScoringResult {
  decision: BidDecision;
  expectedValue: number;
  estimatedWinRate: number;
  computeCostEst: number;
  riskPenalty: number;
  confidenceScore: number;
  reasoning: string;
}

// ─── Agent Types ──────────────────────────────────────────────

export interface AgentContext {
  bountyId: string;
  title: string;
  description: string;
  rewardUsd: number;
  taskType: TaskType;
  classification: ClassificationResult;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  rank: number;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  fetchedAt: string;
  wordCount: number;
}

export interface Citation {
  index: number;
  title: string;
  url: string;
  relevance: string;
}

export interface AgentResult {
  content: string;
  summary: string;
  sources: Citation[];
  computeCostActual: number;
  confidence: number;
  metadata: Record<string, unknown>;
}

// ─── Queue Job Payloads ───────────────────────────────────────

export interface ClassifyJobData {
  bountyId: string;
  title: string;
  description: string;
  rewardUsd: number;
}

export interface ScoreJobData {
  bountyId: string;
  classificationId: string;
  rewardUsd: number;
  taskType: TaskType;
  confidence: number;
}

export interface ResearchJobData {
  bountyId: string;
  bidId: string;
  title: string;
  description: string;
  rewardUsd: number;
  taskType: TaskType;
  classification: ClassificationResult;
}

export interface ReputationUpdateJobData {
  submissionId: string;
  bountyId: string;
  agentType: AgentType;
  outcome: SubmissionStatus;
  payoutAmount: number;
  computeCostActual: number;
  autoScore: number;
  taskType: TaskType;
}

// ─── Auto-Review Types ────────────────────────────────────────

export interface ReviewCriteria {
  accuracy: number;
  completeness: number;
  citationQuality: number;
  verifiability: number;
  conciseness: number;
}

export interface ReviewResult {
  totalScore: number;
  breakdown: ReviewCriteria;
  passed: boolean;
  reasoning: string;
  suggestions: string[];
}

// ─── Reputation Types ─────────────────────────────────────────

export interface CategoryScore {
  attempted: number;
  approved: number;
  rate: number;
}

export interface AgentStats {
  totalBids: number;
  totalSubmissions: number;
  approved: number;
  rejected: number;
  expired: number;
  totalEarnedUsd: number;
  totalComputeCost: number;
  netProfitUsd: number;
  accuracyScore: number;
  rolling30dScore: number;
  avgAutoScore: number;
  categoryScores: Record<string, CategoryScore>;
}

// ─── Scraper Types ────────────────────────────────────────────

export interface ScraperConfig {
  baseUrl: string;
  apiUrl: string;
  pollIntervalMs: number;
  maxBountiesPerPoll: number;
  requestTimeoutMs: number;
}

// ─── API Response Types ───────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

export interface MetricsSnapshot {
  bounties: {
    total: number;
    active: number;
    completed: number;
  };
  bids: {
    total: number;
    accepted: number;
    rejected: number;
    acceptRate: number;
  };
  submissions: {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
    approvalRate: number;
  };
  economics: {
    totalEarnedUsd: number;
    totalComputeCostUsd: number;
    netProfitUsd: number;
    roi: number;
  };
  queues: Record<string, number>;
}
