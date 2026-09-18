import "server-only";

import { z } from "zod";
import type { ProviderMarket, ProviderResult } from "@/lib/markets/types";
import { isNflText } from "@/lib/markets/normalize";
import {
  dollarsToBps,
  dollarsToCents,
  fetchValidated,
  safeIso,
} from "@/lib/providers/http";

const KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2";

const marketSchema = z
  .object({
    ticker: z.string(),
    event_ticker: z.string().optional().default(""),
    title: z.string().optional().default(""),
    subtitle: z.string().optional().default(""),
    yes_sub_title: z.string().optional().default("Yes"),
    no_sub_title: z.string().optional().default("No"),
    status: z.string().optional().default("open"),
    yes_bid_dollars: z.union([z.string(), z.number()]).nullish(),
    yes_ask_dollars: z.union([z.string(), z.number()]).nullish(),
    no_bid_dollars: z.union([z.string(), z.number()]).nullish(),
    no_ask_dollars: z.union([z.string(), z.number()]).nullish(),
    last_price_dollars: z.union([z.string(), z.number()]).nullish(),
    liquidity_dollars: z.union([z.string(), z.number()]).nullish(),
    volume_fp: z.union([z.string(), z.number()]).nullish(),
    volume: z.number().nullish(),
    close_time: z.string().nullish(),
    expiration_time: z.string().nullish(),
    updated_time: z.string().nullish(),
    rules_primary: z.string().nullish(),
    rules_secondary: z.string().nullish(),
    mve_collection_ticker: z.string().nullish(),
    mve_selected_legs: z.array(z.unknown()).nullish(),
  })
  .passthrough();

const marketsResponseSchema = z.object({
  markets: z.array(marketSchema),
  cursor: z.string().optional().default(""),
});

const FALLBACK_NFL_SERIES = [
  "KXNFLGAME",
  "KXNFLSPREAD",
  "KXNFLTOTAL",
] as const;

function collectNflSeries(value: unknown, output = new Set<string>()) {
  if (typeof value === "string") {
    const upper = value.toUpperCase().trim();
    if (/^KX[A-Z0-9]*NFL[A-Z0-9]*$/.test(upper) && upper.length <= 64) {
      output.add(upper);
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNflSeries(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectNflSeries(item, output);
    }
  }
  return output;
}

async function discoverNflSeries() {
  try {
    const payload = await fetchValidated(
      "Kalshi sports filters",
      `${KALSHI_BASE}/search/filters_by_sport`,
      z.unknown(),
    );
    const discovered = [...collectNflSeries(payload)];
    const prioritized = discovered.toSorted((first, second) => {
      const relevant = (value: string) =>
        /GAME|SPREAD|TOTAL|PASS|RUSH|REC|YARD|TD|TOUCH|CATCH/i.test(value)
          ? 1
          : 0;
      return relevant(second) - relevant(first) || first.localeCompare(second);
    });
    return [...new Set([...prioritized.slice(0, 40), ...FALLBACK_NFL_SERIES])];
  } catch (error) {
    console.error("Kalshi NFL series discovery failed", error);
    return [...FALLBACK_NFL_SERIES];
  }
}

async function fetchSeriesMarkets(seriesTicker: string) {
  const markets: z.infer<typeof marketSchema>[] = [];
  let cursor = "";
  try {
    for (let page = 0; page < 4; page += 1) {
      const url = new URL(`${KALSHI_BASE}/markets`);
      url.searchParams.set("status", "open");
      url.searchParams.set("series_ticker", seriesTicker);
      url.searchParams.set("limit", "1000");
      if (cursor) url.searchParams.set("cursor", cursor);
      const payload = await fetchValidated(
        "Kalshi",
        url.toString(),
        marketsResponseSchema,
        { cache: "no-store" },
      );
      markets.push(...payload.markets);
      cursor = payload.cursor;
      if (!cursor) break;
    }
  } catch (error) {
    console.error(`Kalshi series fetch failed for ${seriesTicker}`, error);
  }
  return markets;
}

function isLiveMarket(market: z.infer<typeof marketSchema>) {
  return /live|in.?game|quarter|halftime/i.test(
    `${market.ticker} ${market.title} ${market.subtitle}`,
  );
}

function toProviderMarket(
  market: z.infer<typeof marketSchema>,
  fetchedAt: string,
): ProviderMarket {
  const titleParts = [market.title, market.subtitle]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const title =
    [...new Set(titleParts)].join(" · ") || market.ticker;
  const rules = [market.rules_primary, market.rules_secondary]
    .filter(Boolean)
    .join("\n\n");
  const volumeContracts = Number(market.volume_fp ?? market.volume ?? 0);
  return {
    platform: "kalshi",
    platformMarketId: market.ticker,
    platformOutcomeId: market.ticker,
    eventTitle: market.event_ticker || title,
    marketTitle: title,
    outcomeLabel: market.yes_sub_title || "Yes",
    resolutionRules: rules || null,
    status:
      market.status === "open" || market.status === "active"
        ? "open"
        : market.status === "settled"
          ? "settled"
          : "closed",
    isLive: isLiveMarket(market),
    yesBidBps: dollarsToBps(market.yes_bid_dollars),
    yesAskBps: dollarsToBps(market.yes_ask_dollars),
    noBidBps: dollarsToBps(market.no_bid_dollars),
    noAskBps: dollarsToBps(market.no_ask_dollars),
    lastPriceBps: dollarsToBps(market.last_price_dollars),
    liquidityCents: dollarsToCents(market.liquidity_dollars),
    volumeCents: Number.isFinite(volumeContracts)
      ? Math.round(volumeContracts * 100)
      : null,
    closesAt: market.close_time ?? market.expiration_time ?? null,
    updatedAt: fetchedAt,
    sourceUrl: `https://kalshi.com/markets/${market.ticker.toLowerCase()}`,
  };
}

export async function fetchKalshiNflMarkets(): Promise<ProviderResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const series = await discoverNflSeries();
    const batches = await Promise.all(series.map(fetchSeriesMarkets));
    const raw = new Map<string, z.infer<typeof marketSchema>>();
    for (const market of batches.flat()) {
      raw.set(market.ticker, market);
    }

    const markets: ProviderMarket[] = [];
    for (const market of raw.values()) {
      if (
        market.mve_collection_ticker ||
        (market.mve_selected_legs?.length ?? 0) > 0 ||
        /KXMVE|CROSSCATEGORY/i.test(`${market.ticker} ${market.event_ticker}`)
      ) {
        continue;
      }
      if (
        isNflText(
          market.ticker,
          market.event_ticker,
          market.title,
          market.subtitle,
          market.rules_primary,
          market.rules_secondary,
        )
      ) {
        markets.push(toProviderMarket(market, fetchedAt));
      }
    }

    return { provider: "kalshi", markets, fetchedAt, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Kalshi error";
    console.error("Kalshi market fetch failed", error);
    return {
      provider: "kalshi",
      markets: [],
      fetchedAt,
      error: message,
    };
  }
}
