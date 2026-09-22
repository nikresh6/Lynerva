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
    result: z.string().nullish(),
    settlement_ts: z.string().nullish(),
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

const marketResponseSchema = z.object({ market: marketSchema });

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

const KALSHI_MIN_REFRESH_MS = 60_000;
const KALSHI_SERIES_GAP_MS = 150;
let kalshiSnapshot: ProviderResult | null = null;
let kalshiSnapshotAt = 0;
let kalshiRefreshPromise: Promise<ProviderResult> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const markets: z.infer<typeof marketSchema>[] = [];
  for (const seriesTicker of CORE_NFL_SERIES) {
    markets.push(...(await fetchSeriesMarkets(seriesTicker)));
    await sleep(KALSHI_SERIES_GAP_MS);
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

async function refreshKalshiNflMarkets(): Promise<ProviderResult> {
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

export async function fetchKalshiNflMarkets(): Promise<ProviderResult> {
  const now = Date.now();

  // Game pages, the market API, and the background scheduler can all ask for
  // Kalshi at nearly the same time. Never turn those callers into duplicate
  // upstream bursts.
  if (kalshiSnapshot && now - kalshiSnapshotAt < KALSHI_MIN_REFRESH_MS) {
    return kalshiSnapshot;
  }
  if (kalshiRefreshPromise) return kalshiRefreshPromise;

  kalshiRefreshPromise = refreshKalshiNflMarkets()
    .then((next) => {
      // A partial/empty refresh caused by upstream throttling must never wipe
      // a healthy snapshot. Keep serving the last complete board and retry on
      // a later refresh.
      if (
        kalshiSnapshot &&
        next.markets.length < Math.max(25, kalshiSnapshot.markets.length * 0.5)
      ) {
        console.warn(
          `Kalshi refresh returned only ${next.markets.length} markets; keeping cached ${kalshiSnapshot.markets.length}-market snapshot.`,
        );
        kalshiSnapshotAt = Date.now();
        return kalshiSnapshot;
      }

      kalshiSnapshot = next;
      kalshiSnapshotAt = Date.now();
      return next;
    })
    .catch((error) => {
      if (kalshiSnapshot) {
        console.warn("Kalshi refresh failed; serving cached snapshot.", error);
        kalshiSnapshotAt = Date.now();
        return kalshiSnapshot;
      }
      throw error;
    })
    .finally(() => {
      kalshiRefreshPromise = null;
    });

  return kalshiRefreshPromise;
}

export async function fetchKalshiMarketSettlement(ticker: string) {
  const payload = await fetchValidated(
    "Kalshi",
    `${KALSHI_BASE}/markets/${encodeURIComponent(ticker)}`,
    marketResponseSchema,
    { cache: "no-store" },
  );
  const result = payload.market.result?.toLowerCase();
  if (result !== "yes" && result !== "no") return null;

  const settledAt =
    payload.market.settlement_ts ??
    payload.market.expiration_time ??
    payload.market.updated_time ??
    new Date().toISOString();

  return {
    ticker: payload.market.ticker,
    result,
    settledAt: new Date(settledAt),
  } as const;
}
