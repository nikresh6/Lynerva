import "server-only";

import { z } from "zod";
import type { ProviderMarket, ProviderResult } from "@/lib/markets/types";
import {
  dollarsToBps,
  dollarsToCents,
  fetchValidated,
  safeIso,
} from "@/lib/providers/http";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

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

export async function fetchPolymarketNflMarkets(): Promise<ProviderResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const now = Date.now();
    const windowStart = now - 8 * 60 * 60 * 1_000;
    const windowEnd = now + 8 * 24 * 60 * 60 * 1_000;
    const url = new URL(`${GAMMA_BASE}/events`);
    url.searchParams.set("tag_slug", "nfl");
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("start_date_min", new Date(windowStart).toISOString());
    url.searchParams.set("start_date_max", new Date(windowEnd).toISOString());
    url.searchParams.set("limit", "100");
    const events = await fetchValidated(
      "Polymarket Gamma",
      url.toString(),
      eventsSchema,
      { cache: "no-store" },
    );
    const nflEvents = events
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
        const yesToken = tokens[yesIndex] ?? tokens[0] ?? null;
        const yesAsk = Number(market.bestAsk ?? prices[yesIndex] ?? NaN);
        const yesBid = Number(market.bestBid ?? NaN);
        const noAsk = Number.isFinite(yesBid) ? 1 - yesBid : null;
        const noBid = Number.isFinite(yesAsk) ? 1 - yesAsk : null;
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
          updatedAt: safeIso(market.updatedAt ?? event.updatedAt, fetchedAt),
          sourceUrl: `https://polymarket.com/event/${event.slug}`,
        });
      }
    }

    console.info("Polymarket NFL discovery summary", {
      events: events.length,
      eligibleEvents: nflEvents.length,
      markets: markets.length,
      samples: markets.slice(0, 5).map((market) => ({
        id: market.platformMarketId,
        eventTitle: market.eventTitle,
        marketTitle: market.marketTitle,
        closesAt: market.closesAt,
        yesAskBps: market.yesAskBps,
        noAskBps: market.noAskBps,
      })),
    });

    if (markets.length === 0) {
      console.warn("Polymarket NFL discovery produced zero markets", {
        events: events.length,
        eligibleEvents: nflEvents.length,
        samples: events.slice(0, 4).map((event) => ({
          title: event.title,
          endDate: event.endDate,
          marketCount: event.markets.length,
          firstMarket: event.markets[0]
            ? {
                question: event.markets[0].question,
                gameStartTime: event.markets[0].gameStartTime,
                endDate: event.markets[0].endDate,
                active: event.markets[0].active,
                closed: event.markets[0].closed,
                acceptingOrders: event.markets[0].acceptingOrders,
              }
            : null,
        })),
      });
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
