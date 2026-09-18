import "server-only";

import { fetchKalshiNflMarkets } from "@/lib/kalshi";
import { fetchPolymarketNflMarkets } from "@/lib/polymarket";
import { estimateMarket } from "@/lib/model";
import { getLiveNflGames, type LiveNflGame } from "@/lib/nfl/live";
import { findCurrentRegularSeasonGame } from "@/lib/nfl/current-game";
import { loadNflSchedule } from "@/lib/nfl/schedule";
import {
  findEligibleScheduleGame,
  type NflScheduleGame,
} from "@/lib/nfl/schedule-match";
import { marketFixtures } from "./fixtures";
import { isSingleLegNflProviderMarket } from "./eligibility";
import {
  canonicalKeyWithoutRules,
  normalizeMarket,
  settlementRulesMatch,
} from "./normalize";
import {
  detectArbitrage,
  expectedRoi,
  freshnessFrom,
  opportunityScore,
  riskReturn,
} from "./math";
import type {
  MarketOpportunity,
  MarketSide,
  ProviderMarket,
  ProviderResult,
} from "./types";

export interface MarketsPayload {
  opportunities: MarketOpportunity[];
  providers: ProviderResult[];
  fetchedAt: string;
  fixtureMode: boolean;
}

interface NormalizedItem {
  market: ProviderMarket;
  canonical: NonNullable<ReturnType<typeof normalizeMarket>>;
  scheduleGame: NflScheduleGame;
  liveGame: LiveNflGame | null;
}

let warmSnapshot: { payload: MarketsPayload; storedAt: number } | null = null;
let refreshPromise: Promise<MarketsPayload> | null = null;
const modelSnapshotCache = new Map<
  string,
  {
    estimate: Awaited<ReturnType<typeof estimateMarket>>;
    storedAt: number;
  }
>();

const WARMING_MODEL: Awaited<ReturnType<typeof estimateMarket>> = {
  probabilityBps: null,
  reliabilityBps: 0,
  version: "regular-season-v4-warming",
  evidence: {
    last5Hits: null,
    last10Hits: null,
    seasonHits: null,
    seasonGames: null,
    sampleSize: 0,
  },
  factors: ["Historical model is warming. Live market prices are already current."],
};

async function estimateWithDeadline(
  item: NormalizedItem,
  key: string,
) {
  const cached = modelSnapshotCache.get(key);
  if (cached && Date.now() - cached.storedAt < 15 * 60 * 1_000) {
    return cached.estimate;
  }

  const task = estimateMarket(
    item.canonical,
    item.scheduleGame,
    item.liveGame,
  ).then((estimate) => {
    modelSnapshotCache.set(key, {
      estimate,
      storedAt: Date.now(),
    });
    return estimate;
  });

  const isGameMarket = ["moneyline", "spread", "game_total"].includes(
    item.canonical.family,
  );
  const deadlineMs = isGameMarket ? 3_000 : 1_200;

  return Promise.race([
    task,
    new Promise<Awaited<ReturnType<typeof estimateMarket>>>((resolve) => {
      setTimeout(() => resolve(WARMING_MODEL), deadlineMs);
    }),
  ]);
}

function scheduleGameFromEspn(game: LiveNflGame): NflScheduleGame | null {
  if (game.seasonType !== 2 || !game.seasonYear) return null;
  const kickoff = new Date(game.startsAt);
  if (Number.isNaN(kickoff.getTime())) return null;
  return {
    gameId: game.id,
    season: game.seasonYear,
    week: game.week,
    seasonType: "REG",
    gameday: kickoff.toISOString().slice(0, 10),
    kickoffAt: kickoff.toISOString(),
    homeTeam: game.home.team,
    awayTeam: game.away.team,
    stadium: null,
    roof: null,
  };
}

function candidateQuality(item: NormalizedItem) {
  const executable =
    (item.market.yesAskBps ?? 0) > 0 || (item.market.noAskBps ?? 0) > 0;
  return (
    (executable ? 1_000_000_000 : 0) +
    (item.market.liquidityCents ?? 0) * 10 +
    (item.market.volumeCents ?? 0)
  );
}

function selectModelCandidates(items: NormalizedItem[]) {
  const ranked = items.toSorted(
    (first, second) => candidateQuality(second) - candidateQuality(first),
  );
  const selected: NormalizedItem[] = [];
  const gameCounts = new Map<string, number>();
  const playerCounts = new Map<string, number>();

  for (const item of ranked) {
    const matchup = item.canonical.matchup ?? item.market.eventTitle;
    const isGameMarket = ["moneyline", "spread", "game_total"].includes(
      item.canonical.family,
    );
    const counts = isGameMarket ? gameCounts : playerCounts;
    const perMatchupLimit = isGameMarket ? 5 : 3;
    const count = counts.get(matchup) ?? 0;
    if (count >= perMatchupLimit) continue;
    if (
      !isGameMarket &&
      (item.market.yesAskBps ?? 0) <= 0 &&
      (item.market.noAskBps ?? 0) <= 0
    ) {
      continue;
    }

    selected.push(item);
    counts.set(matchup, count + 1);
    if (selected.length >= 110) break;
  }

  return selected;
}

function bestExecutableSide(input: {
  probabilityBps: number | null;
  yesAskBps: number | null;
  noAskBps: number | null;
}) {
  if (input.probabilityBps === null) {
    return {
      side: null as MarketSide | null,
      probabilityBps: null,
      priceBps: null,
      edgeBps: null,
    };
  }

  const candidates: Array<{
    side: MarketSide;
    probabilityBps: number;
    priceBps: number;
    edgeBps: number;
  }> = [];

  if (
    input.yesAskBps !== null &&
    input.yesAskBps > 0 &&
    input.yesAskBps < 10_000
  ) {
    candidates.push({
      side: "yes",
      probabilityBps: input.probabilityBps,
      priceBps: input.yesAskBps,
      edgeBps: input.probabilityBps - input.yesAskBps,
    });
  }

  if (
    input.noAskBps !== null &&
    input.noAskBps > 0 &&
    input.noAskBps < 10_000
  ) {
    const probabilityBps = 10_000 - input.probabilityBps;
    candidates.push({
      side: "no",
      probabilityBps,
      priceBps: input.noAskBps,
      edgeBps: probabilityBps - input.noAskBps,
    });
  }

  const best = candidates.toSorted(
    (first, second) => second.edgeBps - first.edgeBps,
  )[0];

  return best
    ? best
    : {
        side: null as MarketSide | null,
        probabilityBps: null,
        priceBps: null,
        edgeBps: null,
      };
}

async function computeMarketOpportunities(): Promise<MarketsPayload> {
  const fixtureMode =
    process.env.NODE_ENV !== "production" &&
    process.env.USE_MARKET_FIXTURES === "true";

  const providerPromise = fixtureMode
    ? Promise.resolve([
        {
          provider: "kalshi" as const,
          markets: marketFixtures.filter(
            (market) => market.platform === "kalshi",
          ),
          fetchedAt: new Date().toISOString(),
          error: null,
        },
        {
          provider: "polymarket" as const,
          markets: marketFixtures.filter(
            (market) => market.platform === "polymarket",
          ),
          fetchedAt: new Date().toISOString(),
          error: null,
        },
      ])
    : Promise.all([fetchKalshiNflMarkets(), fetchPolymarketNflMarkets()]);

  const [providers, liveGames] = await Promise.all([
    providerPromise,
    getLiveNflGames(),
  ]);

  const coarseProviders = providers.map((provider) => ({
    ...provider,
    markets: provider.markets.filter(isSingleLegNflProviderMarket),
  }));

  const providerMarkets = coarseProviders.flatMap(
    (provider) => provider.markets,
  );

  const normalizeWithSchedule = (
    scheduleGames: NflScheduleGame[] | null,
  ) => {
    const items: NormalizedItem[] = [];
    for (const market of providerMarkets) {
      const canonical = normalizeMarket(market);
      if (!canonical) continue;

      const liveGame = findCurrentRegularSeasonGame(
        canonical.matchup,
        liveGames,
      );
      const scheduleGame =
        (liveGame ? scheduleGameFromEspn(liveGame) : null) ??
        (scheduleGames
          ? findEligibleScheduleGame(canonical, scheduleGames)
          : null);
      if (!scheduleGame) continue;

      if (
        !liveGame &&
        scheduleGames &&
        new Date(scheduleGame.kickoffAt).getTime() <= Date.now()
      ) {
        continue;
      }

      items.push({
        market,
        canonical,
        scheduleGame,
        liveGame,
      });
    }
    return items;
  };

  let normalized = normalizeWithSchedule(null);

  // Some serverless hosts intermittently fail to reach ESPN even while the
  // market providers are healthy. Do not turn that transient scoreboard
  // outage into an empty Lynerva feed. Fall back to the public nflverse
  // regular-season schedule only when ESPN produced no usable mappings.
  if (normalized.length === 0 && providerMarkets.length > 0) {
    try {
      normalized = normalizeWithSchedule(await loadNflSchedule());
    } catch (error) {
      console.error("NFL schedule fallback unavailable", error);
    }
  }

  const modeled = selectModelCandidates(normalized);
  const accepted = new Set(
    modeled.map((item) => marketKey(item.market)),
  );
  const cleanProviders = coarseProviders.map((provider) => ({
    ...provider,
    markets: provider.markets.filter((market) =>
      accepted.has(marketKey(market)),
    ),
  }));

  const raw = modeled.map((item) => item.market);

  const models = await Promise.all(
    modeled.map(async (item) => {
      const liveKey =
        item.liveGame?.state === "in"
          ? `:${item.liveGame.period}:${item.liveGame.clock}:${item.liveGame.home.score}:${item.liveGame.away.score}`
          : ":pregame";
      const key = `${item.canonical.key}${liveKey}`;
      return estimateWithDeadline(item, key);
    }),
  );

  const groups = new Map<string, number[]>();
  modeled.forEach((item, index) => {
    const key = canonicalKeyWithoutRules(item.canonical);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  const comparison = new Map<
    number,
    Pick<
      MarketOpportunity,
      "discrepancyBps" | "equivalentPlatform" | "arbitrage"
    >
  >();

  for (const indexes of groups.values()) {
    const kalshiIndex = indexes.find(
      (index) => raw[index]?.platform === "kalshi",
    );
    const polymarketIndex = indexes.find(
      (index) => raw[index]?.platform === "polymarket",
    );
    if (kalshiIndex === undefined || polymarketIndex === undefined) continue;

    const first = modeled[kalshiIndex];
    const second = modeled[polymarketIndex];
    if (!first || !second) continue;

    const firstPrice = raw[kalshiIndex]?.yesAskBps;
    const secondPrice = raw[polymarketIndex]?.yesAskBps;
    const discrepancy =
      firstPrice !== null && secondPrice !== null
        ? Math.abs(firstPrice - secondPrice)
        : null;
    const arbitrage = detectArbitrage({
      canonicalKey: canonicalKeyWithoutRules(first.canonical),
      first: first.market,
      second: second.market,
      settlementRulesMatch: settlementRulesMatch(
        first.canonical,
        second.canonical,
      ),
    });

    comparison.set(kalshiIndex, {
      discrepancyBps: discrepancy,
      equivalentPlatform: "polymarket",
      arbitrage,
    });
    comparison.set(polymarketIndex, {
      discrepancyBps: discrepancy,
      equivalentPlatform: "kalshi",
      arbitrage,
    });
  }

  const now = Date.now();
  const opportunities = modeled.map(
    (item, index): MarketOpportunity => {
      const model = models[index];
      const market = item.market;
      const live = item.liveGame?.state === "in";
      const side = bestExecutableSide({
        probabilityBps: model.probabilityBps,
        yesAskBps: market.yesAskBps,
        noAskBps: market.noAskBps,
      });
      const spreadBps =
        market.yesAskBps !== null && market.yesBidBps !== null
          ? market.yesAskBps - market.yesBidBps
          : null;
      const ageSeconds = Math.max(
        0,
        (now - new Date(market.updatedAt).getTime()) / 1_000,
      );
      const peer = comparison.get(index);

      return {
        ...market,
        isLive: live,
        canonical: item.canonical,
        model,
        recommendedSide: side.side,
        recommendedProbabilityBps: side.probabilityBps,
        executablePriceBps: side.priceBps,
        edgeBps: side.edgeBps,
        expectedRoi:
          side.probabilityBps !== null && side.priceBps !== null
            ? expectedRoi(side.probabilityBps, side.priceBps)
            : null,
        riskReturn:
          side.priceBps === null ? null : riskReturn(side.priceBps),
        spreadBps,
        opportunityScore:
          side.edgeBps !== null && side.priceBps !== null
            ? opportunityScore({
                edgeBps: side.edgeBps,
                priceBps: side.priceBps,
                reliabilityBps: model.reliabilityBps,
                liquidityCents: market.liquidityCents,
                spreadBps,
                ageSeconds,
              })
            : null,
        freshness: freshnessFrom(market.updatedAt, now),
        discrepancyBps: peer?.discrepancyBps ?? null,
        equivalentPlatform: peer?.equivalentPlatform ?? null,
        arbitrage: peer?.arbitrage ?? null,
      };
    },
  );

  return {
    opportunities,
    providers: cleanProviders,
    fetchedAt: new Date().toISOString(),
    fixtureMode,
  };
}

async function refreshSnapshot() {
  if (!refreshPromise) {
    refreshPromise = computeMarketOpportunities()
      .then((payload) => {
        warmSnapshot = { payload, storedAt: Date.now() };
        return payload;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function getMarketOpportunities(): Promise<MarketsPayload> {
  const now = Date.now();
  if (warmSnapshot && now - warmSnapshot.storedAt < 3_000) {
    return warmSnapshot.payload;
  }

  if (warmSnapshot) {
    void refreshSnapshot();
    return warmSnapshot.payload;
  }

  return refreshSnapshot();
}

export async function getFreshMarketOpportunities() {
  return refreshSnapshot();
}

export function marketKey(market: ProviderMarket) {
  return `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
}
