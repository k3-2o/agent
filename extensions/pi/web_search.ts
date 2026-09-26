/**
 * web_search — Unified, cost-aware search middleware
 *
 * Routes web search, discovery, and extraction across Serper, Exa,
 * Firecrawl, and Tavily based on intent with silent cascading failover.
 *
 * Routing Matrix:
 *   fact       → Serper /search  → Exa /answer       → Tavily /search
 *   discovery  → Exa /search     → Tavily /search     → Serper /search
 *   extraction → Firecrawl v2    → Tavily /extract
 *
 * API keys from environment:
 *   SERPER_API_KEY, EXA_API_KEY, FIRECRAWL_API_KEY, TAVILY_API_KEY
 *
 * Auth: Serper uses X-API-KEY header, Exa uses x-api-key,
 *        Firecrawl uses Bearer, Tavily uses Bearer.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// --- Types ---

interface ProviderConfig {
  id: string;
  label: string;
  url: string;
  envKey: string;
  buildHeaders: (apiKey: string) => Record<string, string>;
  buildBody: (query: string, apiKey: string) => object;
  normalize: (data: any) => NormalizedResult;
}

interface NormalizedResult {
  source: string;
  content: string;
  references: string[];
  /** Cost in USD — only present for providers that report it (Exa). */
  costDollars?: {
    total: number;
    [key: string]: any;
  };
}

interface OmniSearchDetails extends NormalizedResult {
  intent: string;
  query: string;
  routedTo: string;
}

interface ExaSearchResult {
  title?: string;
  url?: string;
  text?: string;
  highlights?: string[];
  summary?: string;
}

interface ExaCitation {
  id?: string;
  url?: string;
  title?: string;
  text?: string;
}

// --- Normalizers ---

function normalizeSerper(data: any): NormalizedResult {
  const organic = Array.isArray(data.organic) ? data.organic : [];
  const content = organic
    .map(
      (r: any, i: number) =>
        `${i + 1}. **${r.title ?? "Untitled"}**\n   ${r.snippet ?? ""}\n   ${r.link ?? ""}`,
    )
    .join("\n\n");
  const references = organic.map((r: any) => r.link ?? "").filter(Boolean);
  return { source: "serper", content: content || "(no results)", references };
}

function normalizeExaSearch(data: any): NormalizedResult {
  const results: ExaSearchResult[] = Array.isArray(data.results)
    ? data.results
    : [];
  const parts = results.map((r, i) => {
    let block = `${i + 1}. **${r.title ?? "Untitled"}**\n`;
    if (r.summary) block += `   *${r.summary}*\n`;
    if (r.text) block += `   ${r.text.slice(0, 600)}\n`;
    if (r.highlights?.length) {
      const h = r.highlights.join(" | ");
      block += `   > ${h.slice(0, 400)}\n`;
    }
    block += `   ${r.url ?? ""}`;
    return block;
  });
  const content = parts.join("\n\n");
  const references = results.map((r) => r.url ?? "").filter(Boolean);
  const costDollars = data.costDollars?.total != null ? data.costDollars : undefined;
  return {
    source: "exa",
    content: content || "(no results)",
    references,
    costDollars,
  };
}

function normalizeExaAnswer(data: any): NormalizedResult {
  const answer = typeof data.answer === "string" ? data.answer : "";
  const citations: ExaCitation[] = Array.isArray(data.citations)
    ? data.citations
    : [];
  let content = `**Answer:** ${answer}`;
  if (citations.length) {
    content += "\n\n**Sources:**\n" + citations
      .map((c, i) => `${i + 1}. [${c.title ?? c.url ?? "Source"}](${c.url ?? ""})`)
      .join("\n");
  }
  const references = citations.map((c) => c.url ?? "").filter(Boolean);
  const costDollars = data.costDollars?.total != null ? data.costDollars : undefined;
  return { source: "exa", content, references, costDollars };
}

function normalizeFirecrawl(data: any): NormalizedResult {
  // v2 response: markdown at top level. v1 fallback: nested under data.
  const markdown: string =
    data?.markdown ?? data?.data?.markdown ?? "";
  const sourceUrl: string =
    data?.url ??
    data?.metadata?.sourceURL ??
    data?.data?.metadata?.sourceURL ??
    "";
  return {
    source: "firecrawl",
    content: markdown || "(no content extracted)",
    references: sourceUrl ? [sourceUrl] : [],
  };
}

function normalizeTavilySearch(data: any): NormalizedResult {
  const results = Array.isArray(data.results) ? data.results : [];
  const answer = typeof data.answer === "string" ? data.answer : "";
  let content = "";
  if (answer) content += `**Answer:** ${answer}\n\n---\n\n`;
  content += results
    .map(
      (r: any, i: number) =>
        `${i + 1}. **${r.title ?? "Untitled"}**\n   ${(r.content ?? "").slice(0, 600)}\n   ${r.url ?? ""}`,
    )
    .join("\n\n");
  const references = results.map((r: any) => r.url ?? "").filter(Boolean);
  return { source: "tavily", content: content || "(no results)", references };
}

function normalizeTavilyExtract(data: any): NormalizedResult {
  const results = Array.isArray(data.results) ? data.results : [];
  const content = results
    .map(
      (r: any, i: number) =>
        `${i + 1}. **${r.url ?? "URL"}**\n   ${(r.raw_content ?? "").slice(0, 800)}`,
    )
    .join("\n\n");
  const references = results.map((r: any) => r.url ?? "").filter(Boolean);
  return {
    source: "tavily",
    content: content || "(no content extracted)",
    references,
  };
}

// --- Provider definitions ---

const SERPER: ProviderConfig = {
  id: "serper_search",
  label: "serper",
  url: "https://google.serper.dev/search",
  envKey: "SERPER_API_KEY",
  buildHeaders: (apiKey) => ({
    "X-API-KEY": apiKey,
    "Content-Type": "application/json",
  }),
  buildBody: (query) => ({ q: query, num: 10 }),
  normalize: normalizeSerper,
};

const TAVILY_SEARCH: ProviderConfig = {
  id: "tavily_search",
  label: "tavily",
  url: "https://api.tavily.com/search",
  envKey: "TAVILY_API_KEY",
  buildHeaders: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  buildBody: (query) => ({
    query,
    search_depth: "basic",
    include_answer: true,
    max_results: 10,
  }),
  normalize: normalizeTavilySearch,
};

const TAVILY_SEARCH_ADVANCED: ProviderConfig = {
  id: "tavily_search_advanced",
  label: "tavily",
  url: "https://api.tavily.com/search",
  envKey: "TAVILY_API_KEY",
  buildHeaders: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  buildBody: (query) => ({
    query,
    search_depth: "advanced",
    include_answer: true,
    max_results: 10,
  }),
  normalize: normalizeTavilySearch,
};

const TAVILY_EXTRACT: ProviderConfig = {
  id: "tavily_extract",
  label: "tavily",
  url: "https://api.tavily.com/extract",
  envKey: "TAVILY_API_KEY",
  buildHeaders: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  buildBody: (query) => ({
    urls: [query],
    format: "markdown",
  }),
  normalize: normalizeTavilyExtract,
};

const EXA_SEARCH: ProviderConfig = {
  id: "exa_search",
  label: "exa",
  url: "https://api.exa.ai/search",
  envKey: "EXA_API_KEY",
  buildHeaders: (apiKey) => ({
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  }),
  buildBody: (query) => ({
    query,
    type: "auto",
    numResults: 10,
    contents: { text: true, highlights: true },
  }),
  normalize: normalizeExaSearch,
};

const EXA_ANSWER: ProviderConfig = {
  id: "exa_answer",
  label: "exa",
  url: "https://api.exa.ai/answer",
  envKey: "EXA_API_KEY",
  buildHeaders: (apiKey) => ({
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  }),
  buildBody: (query) => ({ query, text: true }),
  normalize: normalizeExaAnswer,
};

const FIRECRAWL: ProviderConfig = {
  id: "firecrawl_v2",
  label: "firecrawl",
  url: "https://api.firecrawl.dev/v2/scrape",
  envKey: "FIRECRAWL_API_KEY",
  buildHeaders: (apiKey) => ({
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  buildBody: (query) => ({ url: query, formats: ["markdown"] }),
  normalize: normalizeFirecrawl,
};

// --- Intent → ordered provider list ---

type Intent = "fact" | "discovery" | "extraction";

const INTENT_ROUTING: Record<Intent, ProviderConfig[]> = {
  fact:       [SERPER,          EXA_ANSWER,          TAVILY_SEARCH],
  discovery:  [EXA_SEARCH,      TAVILY_SEARCH_ADVANCED, SERPER],
  extraction: [FIRECRAWL,       TAVILY_EXTRACT],
};

// --- HTTP helpers ---

const TIMEOUT_MS = 15_000;

function mergedSignal(
  agentSignal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (agentSignal && !agentSignal.aborted) {
    return AbortSignal.any([agentSignal, timeoutSignal]);
  }
  return timeoutSignal;
}

async function callProvider(
  provider: ProviderConfig,
  query: string,
  apiKey: string,
  agentSignal: AbortSignal | undefined,
): Promise<NormalizedResult> {
  const signal = mergedSignal(agentSignal, TIMEOUT_MS);
  const response = await fetch(provider.url, {
    method: "POST",
    headers: provider.buildHeaders(apiKey),
    body: JSON.stringify(provider.buildBody(query, apiKey)),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(could not read body)");
    throw new Error(
      `${provider.id} returned HTTP ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  const json = await response.json();
  return provider.normalize(json);
}

// --- Extension ---
const EMPTY_CONTENT_SENTINELS = ["(no results)", "(no content extracted)"];

export function createWebSearchTool() {
  return {

    name: "web_search",
    label: "Web Search",
    description:
      "Unified web search, discovery, and extraction. " +
      "Routes to the best provider based on intent: " +
      '"fact" (quick facts, definitions), ' +
      '"discovery" (broad research, finding resources), ' +
      '"extraction" (scrape a URL for content). ' +
      "Failover is automatic and silent.",
    promptSnippet:
      "Search the web, discover resources, or extract page content — all through one tool",
    promptGuidelines: [
      "Use web_search with intent='fact' for quick factual lookups, definitions, and simple Q&A.",
      "Use web_search with intent='discovery' for broad research, finding articles, and exploring topics.",
      "Use web_search with intent='extraction' when you need to scrape and extract content from a specific URL — pass the URL as the query.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "Search query, or URL for 'extraction' intent (pass the URL to scrape)",
      }),
      intent: StringEnum([
        "fact",
        "discovery",
        "extraction",
      ] as const),
    }),

    renderCall(args, theme) {
      const intent = args.intent ?? "?";
      const query = typeof args.query === "string" ? args.query : "";
      const preview = query.length > 50 ? query.slice(0, 47) + "..." : query;
      const line =
        theme.fg("toolTitle", theme.bold("web_search ")) +
        theme.fg("muted", `${intent} `) +
        theme.fg("dim", `"${preview}"`);
      return new Text(line, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      if (result.isError) {
        const text = result.content?.[0];
        const msg = text?.type === "text" ? text.text : "aborted";
        const preview = msg.length > 80 ? msg.slice(0, 77) + "..." : msg;
        const line =
          theme.fg("error", "✗ ") +
          theme.fg("dim", "web_search: ") +
          theme.fg("muted", preview);
        return new Text(line, 0, 0);
      }

      const d = result.details as OmniSearchDetails | undefined;
      if (!d) {
        const text = result.content?.[0];
        return new Text(
          text?.type === "text" ? text.text.slice(0, 80) : "",
          0,
          0,
        );
      }
      const line =
        theme.fg("success", "✓ ") +
        theme.fg("dim", `${d.routedTo} · `) +
        theme.fg("muted", `${d.references.length} refs`);
      if (!expanded) return new Text(line, 0, 0);
      return new Text(line + "\n" + theme.fg("dim", d.content), 0, 0);
    },

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {

      const { query, intent } = params as { query: string; intent: Intent };

      if (signal?.aborted) {
        throw new Error("web_search: aborted before execution");
      }

      onUpdate?.({
        content: [
          {
            type: "text",
            text: `web_search: routing "${intent}" intent...`,
          },
        ],
      });

      const routing = INTENT_ROUTING[intent];
      const errors: string[] = [];

      for (const provider of routing) {
        if (signal?.aborted) {
          throw new Error("web_search: aborted");
        }

        const apiKey = process.env[provider.envKey];

        if (!apiKey) {
          errors.push(`${provider.id}: API key not set (${provider.envKey})`);
          continue;
        }

        try {
          onUpdate?.({
            content: [
              {
                type: "text",
                text: `web_search: trying ${provider.id}...`,
              },
            ],
          });

          const normalized = await callProvider(provider, query, apiKey, signal);

          if (!normalized.content || EMPTY_CONTENT_SENTINELS.includes(normalized.content)) {
            throw new Error(`${provider.id}: returned empty content`);
          }

          const details: OmniSearchDetails = {
            ...normalized,
            intent,
            query,
            routedTo: provider.label,
          };

          return {
            content: [
              {
                type: "text",
                text: `[web_search · source: ${normalized.source} · intent: ${intent}]\n\n${normalized.content}`,
              },
            ],
            details,
          };
        } catch (err) {
          if (signal?.aborted) {
            throw new Error("web_search: aborted");
          }
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${provider.id}: ${msg}`);
          continue;
        }
      }

      const errorSummary = errors.map((e) => `  - ${e}`).join("\n");
      throw new Error(
        `web_search: all providers exhausted for intent "${intent}".\nErrors:\n${errorSummary}`,
      );
    },

  };
}

export default function omniSearchGateway(pi: ExtensionAPI) {
  pi.registerTool(createWebSearchTool());
}