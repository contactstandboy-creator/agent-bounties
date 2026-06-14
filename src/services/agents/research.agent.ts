import { anthropic, CLAUDE_MODELS, extractText, extractCost, parseJsonResponse } from "@/lib/anthropic";
import { config } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { BaseAgent } from "./base.agent";
import type {
  AgentContext,
  AgentResult,
  SearchResult,
  ExtractedContent,
  Citation,
} from "@/types";

const log = createLogger("research-agent");

// ─── Search Provider ──────────────────────────────────────────

/**
 * Brave Search API integration.
 * Falls back to a structured DuckDuckGo scrape if no API key.
 */
async function searchBrave(
  query: string,
  count = 5
): Promise<SearchResult[]> {
  if (!config.BRAVE_SEARCH_API_KEY) {
    log.warn("No Brave API key — using DuckDuckGo fallback");
    return searchDuckDuckGo(query, count);
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("result_filter", "web");

  const res = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": config.BRAVE_SEARCH_API_KEY,
    },
  });

  if (!res.ok) {
    log.warn({ status: res.status }, "Brave Search API error, falling back");
    return searchDuckDuckGo(query, count);
  }

  const data = await res.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  };
  const results = data?.web?.results ?? [];

  return results.slice(0, count).map((r, i): SearchResult => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
    rank: i + 1,
  }));
}

/**
 * DuckDuckGo HTML scrape fallback.
 * No API key required, lower quality.
 */
async function searchDuckDuckGo(
  query: string,
  count = 5
): Promise<SearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!res.ok) return [];

    const html = await res.text();
    const results: SearchResult[] = [];

    // Simple regex extraction for DuckDuckGo HTML results
    const linkPattern =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetPattern =
      /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]*)<\/a>/gi;

    const links = [...html.matchAll(linkPattern)].slice(0, count);
    const snippets = [...html.matchAll(snippetPattern)];

    for (let i = 0; i < links.length; i++) {
      const match = links[i];
      const href = match?.[1];
      const title = match?.[2];

      if (!href || !title) continue;

      // DuckDuckGo redirects URLs — extract the actual URL
      const actualUrl = href.startsWith("//duckduckgo.com/l/")
        ? decodeURIComponent(href.split("uddg=")[1]?.split("&")[0] ?? href)
        : href;

      results.push({
        title: title.trim(),
        url: actualUrl,
        snippet: snippets[i]?.[1]?.trim() ?? "",
        rank: i + 1,
      });
    }

    return results;
  } catch (err) {
    log.error({ err }, "DuckDuckGo search failed");
    return [];
  }
}

// ─── Content Extraction ───────────────────────────────────────

/**
 * Fetch and extract clean text content from a URL.
 * Uses a simple fetch + HTML stripping approach.
 */
async function extractContent(
  url: string,
  timeoutMs = 10_000
): Promise<ExtractedContent | null> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentBounties/1.0; +https://agentbounties.xyz)",
        Accept: "text/html,application/xhtml+xml",
      },
    }).finally(() => clearTimeout(id));

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return null;
    }

    const html = await res.text();

    // Strip HTML to get readable text
    const text = stripHtml(html);

    if (text.length < 100) return null; // Skip nearly empty pages

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? url;

    return {
      url,
      title: title.slice(0, 200),
      content: text.slice(0, 6_000), // Cap at 6k chars per source
      fetchedAt: new Date().toISOString(),
      wordCount: text.split(/\s+/).length,
    };
  } catch {
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ─── Prompts ──────────────────────────────────────────────────

const QUERY_GENERATION_PROMPT = `You are a research specialist. Generate targeted web search queries to answer a bounty task.

Return JSON only:
{
  "queries": [
    "specific search query 1",
    "specific search query 2",
    "specific search query 3"
  ],
  "focus_areas": ["What this research should cover", "Key questions to answer"]
}`;

const SYNTHESIS_PROMPT = `You are an expert research writer completing a paid bounty task.

Your submission will be reviewed by a human and must be:
1. Factually accurate and well-sourced
2. Directly responsive to the bounty requirements
3. Clear, professional, and well-structured
4. Verifiable by an independent reviewer

Format your response as a complete submission ready to deliver.
Include inline citations using [1], [2] etc. format.

Write in clear, professional prose. Be specific and substantive, not vague.`;

// ─── Research Agent ───────────────────────────────────────────

export class ResearchAgent extends BaseAgent {
  constructor() {
    super("research-agent");
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    this.log.info({ bountyId: context.bountyId, title: context.title }, "Starting research");

    const costs: number[] = [];

    // Step 1: Generate search queries
    const { queries, focusAreas, cost: queryCost } = await this.generateQueries(context);
    costs.push(queryCost);

    this.log.debug({ bountyId: context.bountyId, queries }, "Generated search queries");

    // Step 2: Execute searches in parallel
    const allSearchResults: SearchResult[] = [];
    const searchPromises = queries.map((q) => searchBrave(q, 4));
    const searchGroups = await Promise.allSettled(searchPromises);

    for (const group of searchGroups) {
      if (group.status === "fulfilled") {
        allSearchResults.push(...group.value);
      }
    }

    // Deduplicate URLs
    const uniqueUrls = new Set<string>();
    const deduped = allSearchResults.filter((r) => {
      if (uniqueUrls.has(r.url)) return false;
      uniqueUrls.add(r.url);
      return true;
    });

    this.log.debug(
      { bountyId: context.bountyId, total: allSearchResults.length, unique: deduped.length },
      "Search results collected"
    );

    // Step 3: Fetch top results in parallel (max 6 sources)
    const topResults = deduped.slice(0, 6);
    const extractPromises = topResults.map((r) => extractContent(r.url));
    const extractedRaw = await Promise.allSettled(extractPromises);

    const extracted: ExtractedContent[] = [];
    const matchedResults: SearchResult[] = [];

    for (let i = 0; i < extractedRaw.length; i++) {
      const result = extractedRaw[i];
      if (result?.status === "fulfilled" && result.value) {
        extracted.push(result.value);
        if (topResults[i]) matchedResults.push(topResults[i]!);
      }
    }

    this.log.info(
      { bountyId: context.bountyId, sourcesExtracted: extracted.length },
      "Content extracted"
    );

    // Step 4: Synthesize with Claude Sonnet
    const { content, summary, cost: synthesisCost } = await this.synthesize(
      context,
      extracted,
      matchedResults,
      focusAreas
    );
    costs.push(synthesisCost);

    // Step 5: Build citations
    const sources: Citation[] = extracted.map((e, i) => ({
      index: i + 1,
      title: e.title,
      url: e.url,
      relevance: matchedResults[i]?.snippet ?? "",
    }));

    const computeCostActual = this.sumCosts(costs);

    this.log.info(
      { bountyId: context.bountyId, computeCostActual, sources: sources.length },
      "Research complete"
    );

    return {
      content: this.truncateContent(content),
      summary,
      sources,
      computeCostActual,
      confidence: 0.80,
      metadata: {
        queriesUsed: queries,
        focusAreas,
        sourcesAttempted: topResults.length,
        sourcesExtracted: extracted.length,
      },
    };
  }

  private async generateQueries(context: AgentContext): Promise<{
    queries: string[];
    focusAreas: string[];
    cost: number;
  }> {
    const userMessage = `
Bounty title: ${context.title}

Bounty description:
${context.description}

Reward: $${context.rewardUsd}

Sub-tasks identified: ${context.classification.subTasks?.join(", ") ?? "See description"}

Generate 3-4 targeted web search queries to gather the information needed. 
Make queries specific and actionable.
Respond with JSON only.`.trim();

    const response = await anthropic.messages.create({
      model: CLAUDE_MODELS.HAIKU,
      max_tokens: 400,
      system: QUERY_GENERATION_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const cost = extractCost(response);
    const text = extractText(response);

    const parsed = parseJsonResponse<{
      queries: string[];
      focus_areas: string[];
    }>(text);

    return {
      queries: parsed.queries?.slice(0, 4) ?? [context.title],
      focusAreas: parsed.focus_areas ?? [],
      cost,
    };
  }

  private async synthesize(
    context: AgentContext,
    extracted: ExtractedContent[],
    searchResults: SearchResult[],
    focusAreas: string[]
  ): Promise<{ content: string; summary: string; cost: number }> {
    // Build context from extracted content
    const sourceContext = extracted
      .map(
        (e, i) => `
### Source [${i + 1}]: ${e.title}
URL: ${e.url}
${e.content}`
      )
      .join("\n\n");

    const userMessage = `
## Bounty Task

**Title:** ${context.title}

**Full Description:**
${context.description}

**Reward:** $${context.rewardUsd}

**Focus Areas:**
${focusAreas.map((f) => `- ${f}`).join("\n")}

## Research Sources

${sourceContext.slice(0, 20_000)}

## Instructions

Write a complete, submission-ready response to this bounty.
- Directly address every aspect of the bounty requirements
- Use inline citations like [1] for claims sourced from the provided sources
- Be specific with numbers, dates, and facts where available
- Structure with clear headers if the task has multiple parts
- End with a brief one-paragraph summary

Write the submission now:`.trim();

    const response = await anthropic.messages.create({
      model: CLAUDE_MODELS.SONNET,
      max_tokens: 3000,
      system: SYNTHESIS_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const cost = extractCost(response);
    const content = extractText(response);

    // Generate a brief summary using Haiku
    const summaryResponse = await anthropic.messages.create({
      model: CLAUDE_MODELS.HAIKU,
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content: `Summarize this bounty submission in 1-2 sentences (max 150 chars):\n\n${content.slice(0, 2000)}`,
        },
      ],
    });

    const summaryText = extractText(summaryResponse);
    const summaryCost = extractCost(summaryResponse);

    return {
      content,
      summary: summaryText.slice(0, 300),
      cost: cost + summaryCost,
    };
  }
}

// Export singleton instance
export const researchAgent = new ResearchAgent();
