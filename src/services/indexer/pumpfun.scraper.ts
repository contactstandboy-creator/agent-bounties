import * as cheerio from "cheerio";
import { config } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import type { RawBounty } from "@/types";

const log = createLogger("pumpfun-scraper");

// ─── HTTP Helpers ─────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentBounties/1.0; +https://agentbounties.xyz)",
        Accept: "application/json, text/html, */*",
        ...options.headers,
      },
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ─── API Scraper (primary method) ────────────────────────────

/**
 * Attempt to fetch bounties from Pump.fun GO JSON API.
 * URL patterns to try based on common patterns for these platforms.
 */
async function fetchFromApi(page = 1, limit = 50): Promise<RawBounty[]> {
  const endpoints = [
    `${config.PUMPFUN_GO_API_URL}/bounties?status=active&page=${page}&limit=${limit}`,
    `${config.PUMPFUN_GO_BASE_URL}/api/bounties?status=active&page=${page}&limit=${limit}`,
    `${config.PUMPFUN_GO_BASE_URL}/api/v1/bounties?active=true`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        log.debug({ endpoint, status: res.status }, "API endpoint not available");
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        log.debug({ endpoint, contentType }, "Not JSON response, skipping");
        continue;
      }

      const data = (await res.json()) as unknown;
      const bounties = normalizeApiResponse(data, endpoint);
      log.info({ endpoint, count: bounties.length }, "Fetched bounties from API");
      return bounties;
    } catch (err) {
      log.debug({ endpoint, err }, "API endpoint failed");
    }
  }

  return [];
}

/**
 * Normalize various API response shapes into RawBounty[].
 */
function normalizeApiResponse(data: unknown, source: string): RawBounty[] {
  if (!data || typeof data !== "object") return [];

  const bounties: RawBounty[] = [];
  const raw = data as Record<string, unknown>;

  // Common response shapes: { bounties: [...] }, { data: [...] }, { items: [...] }, [...]
  const list =
    Array.isArray(data)
      ? data
      : Array.isArray(raw["bounties"])
      ? (raw["bounties"] as unknown[])
      : Array.isArray(raw["data"])
      ? (raw["data"] as unknown[])
      : Array.isArray(raw["items"])
      ? (raw["items"] as unknown[])
      : [];

  for (const item of list) {
    const bounty = parseApiBounty(item as Record<string, unknown>, source);
    if (bounty) bounties.push(bounty);
  }

  return bounties;
}

function parseApiBounty(
  item: Record<string, unknown>,
  source: string
): RawBounty | null {
  try {
    const id = String(item["id"] ?? item["bounty_id"] ?? item["_id"] ?? "");
    const title = String(item["title"] ?? item["name"] ?? "");
    const description = String(
      item["description"] ?? item["body"] ?? item["content"] ?? ""
    );

    const rewardRaw =
      item["reward"] ?? item["amount"] ?? item["prize"] ?? item["payout"];
    const rewardUsd = parseFloat(String(rewardRaw ?? "0"));

    if (!id || !title || rewardUsd <= 0) return null;

    const url =
      String(item["url"] ?? item["link"] ?? "") ||
      `${config.PUMPFUN_GO_BASE_URL}/bounty/${id}`;

    return {
      id,
      title: title.slice(0, 500),
      description: description.slice(0, 10_000),
      rewardUsd,
      rewardSol: item["reward_sol"]
        ? parseFloat(String(item["reward_sol"]))
        : undefined,
      deadline: item["deadline"]
        ? String(item["deadline"])
        : item["expires_at"]
        ? String(item["expires_at"])
        : undefined,
      creatorAddress: item["creator_address"]
        ? String(item["creator_address"])
        : undefined,
      creatorTwitter: item["creator_twitter"] ?? item["twitter"]
        ? String(item["creator_twitter"] ?? item["twitter"])
        : undefined,
      url,
      rawData: item as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

// ─── HTML Scraper (fallback method) ──────────────────────────

/**
 * Scrape bounties from the Pump.fun GO web page.
 * Used as fallback when the API is not available.
 */
async function fetchFromHtml(): Promise<RawBounty[]> {
  const url = `${config.PUMPFUN_GO_BASE_URL}`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      log.warn({ status: res.status }, "HTML scrape failed");
      return [];
    }

    const html = await res.text();
    return parseHtmlBounties(html, url);
  } catch (err) {
    log.error({ err }, "HTML scraper error");
    return [];
  }
}

function parseHtmlBounties(html: string, baseUrl: string): RawBounty[] {
  const $ = cheerio.load(html);
  const bounties: RawBounty[] = [];

  // These selectors will need updating once we see the actual Pump.fun GO HTML.
  // They cover common patterns used by bounty platforms.
  const selectors = [
    "[data-bounty-id]",
    "[data-testid='bounty-card']",
    ".bounty-card",
    ".bounty-item",
    "[class*='bounty']",
  ];

  for (const selector of selectors) {
    const elements = $(selector);
    if (elements.length === 0) continue;

    elements.each((_, el) => {
      const $el = $(el);
      const id =
        $el.attr("data-bounty-id") ??
        $el.attr("data-id") ??
        $el.find("[data-id]").attr("data-id") ??
        String(Date.now() + Math.random());

      const title =
        $el.find("h1, h2, h3, [class*='title']").first().text().trim() ||
        $el.attr("title") ||
        "";

      const description =
        $el
          .find("[class*='description'], [class*='body'], p")
          .first()
          .text()
          .trim() || "";

      const rewardText =
        $el.find("[class*='reward'], [class*='prize'], [class*='amount']").first().text() ||
        "";
      const rewardMatch = rewardText.match(/[\d,]+(?:\.\d+)?/);
      const rewardUsd = rewardMatch
        ? parseFloat(rewardMatch[0].replace(/,/g, ""))
        : 0;

      const href =
        $el.find("a").first().attr("href") ||
        $el.attr("href") ||
        "";
      const url = href.startsWith("http") ? href : `${baseUrl}${href}`;

      if (title && rewardUsd > 0) {
        bounties.push({
          id,
          title: title.slice(0, 500),
          description: description.slice(0, 10_000),
          rewardUsd,
          url,
        });
      }
    });

    if (bounties.length > 0) break; // Found bounties with this selector
  }

  // Also try to find inline JSON state (common in Next.js / React apps)
  const inlineJson = extractInlineJson(html);
  if (inlineJson.length > 0) {
    bounties.push(...inlineJson);
  }

  log.info({ count: bounties.length }, "HTML scrape results");
  return bounties;
}

/**
 * Extract bounties from Next.js __NEXT_DATA__ or similar inline JSON.
 */
function extractInlineJson(html: string): RawBounty[] {
  try {
    const match = html.match(
      /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!match?.[1]) return [];

    const data = JSON.parse(match[1]) as {
      props?: { pageProps?: Record<string, unknown> };
    };
    const pageProps = data?.props?.pageProps ?? {};
    return normalizeApiResponse(pageProps, "inline-json");
  } catch {
    return [];
  }
}

// ─── Public Interface ─────────────────────────────────────────

export interface FetchBountiesResult {
  bounties: RawBounty[];
  method: "api" | "html" | "none";
  error?: string;
}

/**
 * Fetch active bounties from Pump.fun GO.
 * Tries API first, falls back to HTML scraping.
 */
export async function fetchActiveBounties(
  page = 1
): Promise<FetchBountiesResult> {
  log.info({ page }, "Fetching active bounties from Pump.fun GO");

  // Try API first
  const apiBounties = await fetchFromApi(page);
  if (apiBounties.length > 0) {
    return { bounties: apiBounties, method: "api" };
  }

  // Fall back to HTML
  log.info("API returned no results, falling back to HTML scraping");
  const htmlBounties = await fetchFromHtml();
  if (htmlBounties.length > 0) {
    return { bounties: htmlBounties, method: "html" };
  }

  log.warn("No bounties found via any method");
  return {
    bounties: [],
    method: "none",
    error: "No bounties found via API or HTML scraping",
  };
}

/**
 * Fetch a single bounty by its external ID.
 * Used to verify a bounty is still active before submission.
 */
export async function fetchBountyById(
  externalId: string
): Promise<RawBounty | null> {
  const endpoints = [
    `${config.PUMPFUN_GO_API_URL}/bounties/${externalId}`,
    `${config.PUMPFUN_GO_BASE_URL}/api/bounties/${externalId}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetchWithTimeout(endpoint);
      if (!res.ok) continue;

      const data = (await res.json()) as Record<string, unknown>;
      return parseApiBounty(data, endpoint) ?? parseApiBounty(
        (data["data"] ?? data["bounty"]) as Record<string, unknown>,
        endpoint
      );
    } catch {
      continue;
    }
  }

  return null;
}
