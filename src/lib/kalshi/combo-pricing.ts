import "server-only";

import { z } from "zod";
import { dollarsToBps, fetchValidated } from "@/lib/providers/http";

const KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2";
const PAGE_LIMIT = 200;
const MAX_PAGES = 3;
const CACHE_MS = 30_000;

const selectedLegSchema = z
  .object({
    market_ticker: z.string(),
    side: z.string(),
  })
  .passthrough();

const comboMarketSchema = z
  .object({
    ticker: z.string(),
    yes_ask_dollars: z.union([z.string(), z.number()]).nullish(),
    last_price_dollars: z.union([z.string(), z.number()]).nullish(),
    mve_selected_legs: z.array(selectedLegSchema).nullish(),
  })
  .passthrough();

const comboEventSchema = z
  .object({
    markets: z.array(comboMarketSchema).optional().default([]),
  })
  .passthrough();

const responseSchema = z.object({
  events: z.array(comboEventSchema),
  cursor: z.string().optional().default(""),
});

export interface KalshiComboLeg {
  marketTicker: string;
  side: "yes" | "no";
}

export interface KalshiComboRequest {
  key: string;
  legs: KalshiComboLeg[];
}

export interface KalshiComboQuote {
  key: string;
  ticker: string;
  priceBps: number;
  grossReturn: number;
  sourceUrl: string;
}

let snapshot:
  | {
      storedAt: number;
      markets: z.infer<typeof comboMarketSchema>[];
    }
  | null = null;
let inflight: Promise<z.infer<typeof comboMarketSchema>[]> | null = null;

function comboIdentity(legs: KalshiComboLeg[]) {
  return legs
    .map((leg) => `${leg.marketTicker}:${leg.side}`)
    .toSorted()
    .join("|");
}

function marketIdentity(market: z.infer<typeof comboMarketSchema>) {
  const legs = market.mve_selected_legs ?? [];
  return legs
    .map((leg) => `${leg.market_ticker}:${leg.side.toLowerCase()}`)
    .toSorted()
    .join("|");
}

async function loadRecentMultivariateMarkets() {
  if (snapshot && Date.now() - snapshot.storedAt < CACHE_MS) {
    return snapshot.markets;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const markets: z.infer<typeof comboMarketSchema>[] = [];
    let cursor = "";

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = new URL(`${KALSHI_BASE}/events/multivariate`);
      url.searchParams.set("limit", String(PAGE_LIMIT));
      url.searchParams.set("with_nested_markets", "true");
      if (cursor) url.searchParams.set("cursor", cursor);

      const payload = await fetchValidated(
        "Kalshi combo markets",
        url.toString(),
        responseSchema,
        { cache: "no-store" },
      );

      for (const event of payload.events) {
        for (const market of event.markets) {
          if ((market.mve_selected_legs?.length ?? 0) >= 2) {
            markets.push(market);
          }
        }
      }

      cursor = payload.cursor;
      if (!cursor) break;
    }

    snapshot = { storedAt: Date.now(), markets };
    return markets;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export async function findKalshiComboQuotes(
  requests: KalshiComboRequest[],
): Promise<KalshiComboQuote[]> {
  if (!requests.length) return [];

  const wanted = new Map(
    requests
      .filter((request) => request.legs.length >= 2)
      .map((request) => [comboIdentity(request.legs), request.key]),
  );
  if (!wanted.size) return [];

  try {
    const markets = await loadRecentMultivariateMarkets();
    const quotes: KalshiComboQuote[] = [];

    for (const market of markets) {
      const key = wanted.get(marketIdentity(market));
      if (!key) continue;

      const priceBps =
        dollarsToBps(market.yes_ask_dollars) ??
        dollarsToBps(market.last_price_dollars);
      if (priceBps === null || priceBps <= 0 || priceBps >= 10_000) continue;

      quotes.push({
        key,
        ticker: market.ticker,
        priceBps,
        grossReturn: 10_000 / priceBps,
        sourceUrl: `https://kalshi.com/markets/${market.ticker.toLowerCase()}`,
      });
      wanted.delete(marketIdentity(market));
      if (!wanted.size) break;
    }

    return quotes;
  } catch (error) {
    console.error("Kalshi combo quote lookup unavailable", error);
    return [];
  }
}
