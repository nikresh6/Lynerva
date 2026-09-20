import "server-only";

import { z } from "zod";
import type { ProviderMarket, ProviderResult } from "@/lib/markets/types";
import { isNflText } from "@/lib/markets/normalize";
import {
  dollarsToBps,
  dollarsToCents,
  fetchValidated,
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

const CORE_NFL_SERIES = [
  "KXNFLGAME",
  "KXNFLTOTAL",
  "KXNFLPASSYDS",
  "KXNFLPASSTDS",
  "KXNFLPASSINT",
  "KXNFLRECYDS",
  "KXNFLREC",
  "KXNFLRSHYDS",
  "KXNFLTD",
  "KXNFLLONGREC",
] as const;

async function fetchSeriesMarkets(seriesTicker: string) {
  const markets: z.infer<typeof marketSchema>[] = [];
  let cursor = "";

  try {
    do {
      const url = new URL(`${KALSHI_BASE}/markets`);
      url.searchParams.set("status", "open");
      url.searchParams.set("series_ticker", seriesTicker);
      url.searchParams.set("mve_filter", "exclude");
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
    } while (cursor);

    return markets;
  } catch (error) {
    console.error(`Kalshi series fetch failed for ${seriesTicker}`, error);
    return markets;
  }
}

async function fetchCoreSeriesMarkets() {
  const chunks = await Promise.all(CORE_NFL_SERIES.map(fetchSeriesMarkets));
  return chunks.flat();
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
    const raw = new Map<string, z.infer<typeof marketSchema>>();
    const core = await fetchCoreSeriesMarkets();
    for (const market of core) raw.set(market.ticker, market);

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
