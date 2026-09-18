import "server-only";

import { z } from "zod";
import type { ProviderMarket, ProviderResult } from "@/lib/markets/types";
import { isNflText } from "@/lib/markets/normalize";
import {
  dollarsToBps,
  dollarsToCents,
  fetchValidated
} from "@/lib/providers/http";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

const polymarketMarketSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    conditionId: z.string().nullish(),
    question: z.string().optional().default(""),
    slug: z.string().optional().default(""),
    description: z.string().nullish(),
    resolutionSource: z.string().nullish(),
    outcomes: z.union([z.string(), z.array(z.string())]).nullish(),
    clobTokenIds: z.union([z.string(), z.array(z.string())]).nullish(),
    outcomePrices: z.union([z.string(), z.array(z.string())]).nullish(),
    bestBid: z.union([z.string(), z.number()]).nullish(),
    bestAsk: z.union([z.string(), z.number()]).nullish(),
    lastTradePrice: z.union([z.string(), z.number()]).nullish(),
    liquidity: z.union([z.string(), z.number()]).nullish(),
    liquidityNum: z.number().nullish(),
    volume: z.union([z.string(), z.number()]).nullish(),
    volumeNum: z.number().nullish(),
    active: z.boolean().optional().default(true),
    closed: z.boolean().optional().default(false),
    acceptingOrders: z.boolean().optional().default(true),
    endDate: z.string().nullish(),
    gameStartTime: z.string().nullish(),
    updatedAt: z.string().nullish(),
    sportsMarketType: z.string().nullish(),
  })
  .passthrough();

const eventSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    title: z.string().optional().default(""),
    slug: z.string().optional().default(""),
    description: z.string().nullish(),
    endDate: z.string().nullish(),
    updatedAt: z.string().nullish(),
    markets: z.array(polymarketMarketSchema).optional().default([]),
  })
  .passthrough();

const eventsSchema = z.array(eventSchema);

const bookSchema = z.object({
  market: z.string().optional(),
  asset_id: z.string(),
  bids: z.array(z.object({ price: z.string(), size: z.string() })).default([]),
  asks: z.array(z.object({ price: z.string(), size: z.string() })).default([]),
});
const booksSchema = z.array(bookSchema);

function parseStringArray(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function extrema(entries: Array<{ price: string }>, mode: "min" | "max") {
  const values = entries.map((entry) => Number(entry.price)).filter(Number.isFinite);
  if (!values.length) return null;
  return mode === "min" ? Math.min(...values) : Math.max(...values);
}

async function fetchBooks(tokenIds: string[]) {
  const map = new Map<string, z.infer<typeof bookSchema>>();
  const unique = [...new Set(tokenIds)].slice(0, 400);
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += 100) {
    chunks.push(unique.slice(index, index + 100));
  }

  const results = await Promise.all(
    chunks.map(async (tokenChunk) => {
      try {
        return await fetchValidated(
          "Polymarket CLOB",
          `${CLOB_BASE}/books`,
          booksSchema,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              tokenChunk.map((tokenId) => ({ token_id: tokenId })),
            ),
            cache: "no-store",
          },
        );
      } catch (error) {
        console.error("Polymarket order book batch failed", error);
        return [] as z.infer<typeof bookSchema>[];
      }
    }),
  );

  for (const books of results) {
    for (const book of books) map.set(book.asset_id, book);
  }
  return map;
}

export async function fetchPolymarketNflMarkets(): Promise<ProviderResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const url = new URL(`${GAMMA_BASE}/events`);
    url.searchParams.set("tag_slug", "nfl");
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", "120");
    const events = await fetchValidated(
      "Polymarket Gamma",
      url.toString(),
      eventsSchema,
    );
    const now = Date.now();
    const windowStart = now - 8 * 60 * 60 * 1_000;
    const windowEnd = now + 8 * 24 * 60 * 60 * 1_000;
    const nflEvents = events
      .filter((event) =>
        isNflText(event.title, event.slug, event.description),
      )
      .map((event) => ({
        ...event,
        markets: event.markets.filter((market) => {
          if (!market.active || market.closed || !market.acceptingOrders) {
            return false;
          }
          if (/\b(?:combo|parlay|same game parlay|sgp)\b/i.test(
            `${market.question} ${event.title}`,
          )) {
            return false;
          }
          const dateValue =
            market.gameStartTime ?? market.endDate ?? event.endDate;
          if (!dateValue) return false;
          const timestamp = new Date(dateValue).getTime();
          return (
            Number.isFinite(timestamp) &&
            timestamp >= windowStart &&
            timestamp <= windowEnd
          );
        }),
      }))
      .filter((event) => event.markets.length > 0);

    const allTokens = nflEvents.flatMap((event) =>
      event.markets.flatMap((market) => parseStringArray(market.clobTokenIds)),
    );
    const books = await fetchBooks(allTokens);
    const markets: ProviderMarket[] = [];

    for (const event of nflEvents) {
      for (const market of event.markets) {
        if (!market.active || market.closed || !market.acceptingOrders) continue;
        const outcomes = parseStringArray(market.outcomes);
        const tokens = parseStringArray(market.clobTokenIds);
        const prices = parseStringArray(market.outcomePrices);
        const yesIndex = Math.max(
          0,
          outcomes.findIndex((outcome) => /yes|over/i.test(outcome)),
        );
        const noIndex = outcomes.findIndex((outcome) => /no|under/i.test(outcome));
        const yesToken = tokens[yesIndex] ?? tokens[0] ?? null;
        const noToken = noIndex >= 0 ? tokens[noIndex] : tokens[1] ?? null;
        const yesBook = yesToken ? books.get(yesToken) : undefined;
        const noBook = noToken ? books.get(noToken) : undefined;
        const yesAsk = yesBook
          ? extrema(yesBook.asks, "min")
          : Number(market.bestAsk ?? NaN);
        const yesBid = yesBook
          ? extrema(yesBook.bids, "max")
          : Number(market.bestBid ?? NaN);
        const noAsk = noBook ? extrema(noBook.asks, "min") : null;
        const noBid = noBook ? extrema(noBook.bids, "max") : null;
        const rules = [
          market.sportsMarketType
            ? `Sports market type: ${market.sportsMarketType}`
            : null,
          market.description,
          market.resolutionSource,
        ]
          .filter(Boolean)
          .join("\n\n");
        const status = market.closed ? "closed" : market.active ? "open" : "unavailable";
        markets.push({
          platform: "polymarket",
          platformMarketId: market.conditionId ?? market.id,
          platformOutcomeId: yesToken,
          eventTitle: event.title,
          marketTitle: market.question || event.title,
          outcomeLabel: outcomes[yesIndex] ?? "Yes",
          resolutionRules: rules || null,
          status,
          isLive:
            Boolean(market.gameStartTime) &&
            new Date(market.gameStartTime ?? "").getTime() < Date.now(),
          yesBidBps: Number.isFinite(yesBid) ? dollarsToBps(yesBid) : null,
          yesAskBps: Number.isFinite(yesAsk) ? dollarsToBps(yesAsk) : null,
          noBidBps: dollarsToBps(noBid),
          noAskBps: dollarsToBps(noAsk),
          lastPriceBps: dollarsToBps(
            market.lastTradePrice ?? prices[yesIndex] ?? null,
          ),
          liquidityCents: dollarsToCents(
            market.liquidityNum ?? market.liquidity ?? null,
          ),
          volumeCents: dollarsToCents(market.volumeNum ?? market.volume ?? null),
          closesAt: market.endDate ?? event.endDate ?? null,
          updatedAt: fetchedAt,
          sourceUrl: `https://polymarket.com/event/${event.slug}`,
        });
      }
    }

    return { provider: "polymarket", markets, fetchedAt, error: null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Polymarket error";
    console.error("Polymarket market fetch failed", error);
    return {
      provider: "polymarket",
      markets: [],
      fetchedAt,
      error: message,
    };
  }
}
