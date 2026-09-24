import "server-only";

import { fetchKalshiNflMarkets } from "@/lib/kalshi";
import { estimateMarket } from "@/lib/model";
import { blendConditionalWithDnpFairValueBps } from "@/lib/model/injury-availability";
import { getActiveNflSlateGames, type LiveNflGame } from "@/lib/nfl/live";
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
  lynervaScore,
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
  scheduleGame: NflScheduleGame | null;
  liveGame: LiveNflGame | null;
}

let warmSnapshot: { payload: MarketsPayload; storedAt: number } | null = null;
let refreshPromise: Promise<MarketsPayload> | null = null;
const matchupSnapshots = new Map<
  string,
  { payload: MarketsPayload; storedAt: number }
>();
const matchupRefreshPromises = new Map<string, Promise<MarketsPayload>>();
const modelSnapshotCache = new Map<
  string,
  {
    estimate: Awaited<ReturnType<typeof estimateMarket>>;
    storedAt: number;
  }
>();

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
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

function moneylineYesSide(input: {
  probabilityBps: number | null;
  yesAskBps: number | null;
}) {
  if (
    input.probabilityBps === null ||
    input.yesAskBps === null ||
    input.yesAskBps <= 0 ||
    input.yesAskBps >= 10_000
  ) {
    return {
      side: null as MarketSide | null,
      probabilityBps: null,
      priceBps: null,
      edgeBps: null,
    };
  }

  return {
    side: "yes" as const,
    probabilityBps: input.probabilityBps,
    priceBps: input.yesAskBps,
    edgeBps: input.probabilityBps - input.yesAskBps,
  };
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

async function computeMarketOpportunities(
  matchupFilter?: string,
): Promise<MarketsPayload> {
  const fixtureMode =
    process.env.NODE_ENV !== "production" &&
    process.env.USE_MARKET_FIXTURES === "true";

  const liveGamesPromise = getActiveNflSlateGames();
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
      ])
    : Promise.all([fetchKalshiNflMarkets()]);

  const [providers, liveGames] = await Promise.all([
    providerPromise,
    liveGamesPromise,
  ]);

  const coarseProviders = providers.map((provider) => ({
    ...provider,
    markets: provider.markets.filter(isSingleLegNflProviderMarket),
  }));

  const allProviderMarkets = coarseProviders.flatMap(
    (provider) => provider.markets,
  );
  const normalizedMatchupFilter = matchupFilter
    ? matchupFilter
        .split(/[^A-Za-z]+/)
        .map((team) => team.trim().toUpperCase())
        .filter(Boolean)
        .map((team) => (team === "WSH" ? "WAS" : team === "JAC" ? "JAX" : team === "LA" ? "LAR" : team))
        .toSorted()
        .join("-")
    : null;
  const providerMarkets = normalizedMatchupFilter
    ? allProviderMarkets.filter((market) => {
        const canonical = normalizeMarket(market);
        if (!canonical?.matchup) return false;
        const key = canonical.matchup
          .split(/[^A-Za-z]+/)
          .map((team) => team.trim().toUpperCase())
          .filter(Boolean)
          .map((team) => (team === "WSH" ? "WAS" : team === "JAC" ? "JAX" : team === "LA" ? "LAR" : team))
          .toSorted()
          .join("-");
        return key === normalizedMatchupFilter;
      })
    : allProviderMarkets;

  const marketGameDate = (market: ProviderMarket, fallback: string | null) => {
    const text = `${market.platformMarketId} ${market.eventTitle}`.toUpperCase();
    const match = text.match(/(?:^|[-_])(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})(?:[A-Z]|[-_]|$)/);
    if (match) {
      const months: Record<string, string> = {
        JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
        JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
      };
      const month = months[match[2]!];
      if (month) return `20${match[1]}-${month}-${match[3]}`;
    }
    return fallback;
  };

  const isCurrentUpcomingPlayerMarket = (
    canonical: NonNullable<ReturnType<typeof normalizeMarket>>,
    market: ProviderMarket,
  ) => {
    if (
      ["moneyline", "spread", "game_total"].includes(canonical.family) ||
      !canonical.matchup
    ) {
      return false;
    }
    const gameDate = marketGameDate(market, canonical.settlementDate);
    if (!gameDate) return false;
    const timestamp = new Date(`${gameDate}T17:00:00Z`).getTime();
    const now = Date.now();
    const currentSeason = new Date(now).getUTCFullYear();
    return (
      gameDate.startsWith(`${currentSeason}-`) &&
      Number.isFinite(timestamp) &&
      timestamp >= now - 8 * 60 * 60 * 1_000 &&
      timestamp <= now + 7 * 24 * 60 * 60 * 1_000
    );
  };

  const normalizeWithSchedule = (
    scheduleGames: NflScheduleGame[] | null,
    allowPlayerFallback = false,
  ) => {
    const activeScheduleGames = (() => {
      if (!scheduleGames) return null;

      const rolloverCutoff = Date.now() - 8 * 60 * 60 * 1_000;
      const activeGame = scheduleGames
        .filter(
          (game) =>
            game.seasonType === "REG" &&
            game.week !== null &&
            new Date(game.kickoffAt).getTime() >= rolloverCutoff,
        )
        .toSorted(
          (first, second) =>
            new Date(first.kickoffAt).getTime() -
            new Date(second.kickoffAt).getTime(),
        )[0];

      if (!activeGame || activeGame.week === null) return scheduleGames;
      return scheduleGames.filter(
        (game) =>
          game.seasonType === "REG" &&
          game.season === activeGame.season &&
          game.week === activeGame.week,
      );
    })();

    const items: NormalizedItem[] = [];
    for (const market of providerMarkets) {
      const canonical = normalizeMarket(market);
      if (!canonical) continue;
      // Game-winner contracts are first-class Lynerva markets. Spreads and
      // totals stay intentionally excluded so the game-market surface remains
      // a clean two-outcome moneyline board.
      if (["spread", "game_total"].includes(canonical.family)) {
        continue;
      }

      const liveGame = findCurrentRegularSeasonGame(
        canonical.matchup,
        liveGames,
      );
      const scheduleGame =
        (liveGame ? scheduleGameFromEspn(liveGame) : null) ??
        (activeScheduleGames
          ? findEligibleScheduleGame(canonical, activeScheduleGames)
          : null);
      const allowUnscheduledPlayerFallback =
        allowPlayerFallback &&
        !scheduleGames &&
        isCurrentUpcomingPlayerMarket(canonical, market);
      if (!scheduleGame && !allowUnscheduledPlayerFallback) {
        continue;
      }

      if (
        !liveGame &&
        scheduleGame &&
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

  const completeMoneylinePairs = (items: NormalizedItem[]) => {
    const byMatchup = new Map<string, NormalizedItem[]>();
    for (const item of items) {
      if (item.canonical.family !== "moneyline" || !item.canonical.matchup) {
        continue;
      }
      byMatchup.set(item.canonical.matchup, [
        ...(byMatchup.get(item.canonical.matchup) ?? []),
        item,
      ]);
    }

    const synthetic: NormalizedItem[] = [];
    for (const [matchup, rows] of byMatchup) {
      const teams = matchup.split("-").filter(Boolean);
      if (teams.length !== 2) continue;

      const represented = new Set(rows.map((row) => row.canonical.subject));
      const missing = teams.filter((team) => !represented.has(team));
      if (missing.length !== 1) continue;

      // Kalshi usually exposes one YES contract per team, but some binary game
      // events expose only one team contract and represent the opponent as NO.
      // In that case create an internal second outcome from the real executable
      // NO book. The source URL still opens the original Kalshi game contract.
      const source = rows.find(
        (row) =>
          row.market.noAskBps !== null &&
          row.market.noAskBps > 0 &&
          row.market.noAskBps < 10_000,
      );
      if (!source) continue;

      const opponent = missing[0]!;
      const original = source.market;
      const syntheticId = `${original.platformMarketId}::NO::${opponent}`;
      const syntheticMarket: ProviderMarket = {
        ...original,
        platformMarketId: syntheticId,
        platformOutcomeId: syntheticId,
        marketTitle: `${opponent} moneyline`,
        outcomeLabel: opponent,
        yesBidBps: original.noBidBps,
        yesAskBps: original.noAskBps,
        noBidBps: original.yesBidBps,
        noAskBps: original.yesAskBps,
        lastPriceBps:
          original.lastPriceBps === null
            ? null
            : 10_000 - original.lastPriceBps,
      };
      const syntheticCanonical = {
        ...source.canonical,
        key: `${source.canonical.key}:opponent:${opponent.toLowerCase()}`,
        subject: opponent,
        direction: "yes" as const,
      };

      synthetic.push({
        market: syntheticMarket,
        canonical: syntheticCanonical,
        scheduleGame: source.scheduleGame,
        liveGame: source.liveGame,
      });
    }

    return synthetic.length ? [...items, ...synthetic] : items;
  };

  // Some serverless hosts intermittently fail to reach ESPN even while the
  // market providers are healthy. Do not turn that transient scoreboard
  // outage into an empty Lynerva feed. Fall back to the public nflverse
  // regular-season schedule only when ESPN produced no usable mappings.
  if (normalized.length === 0 && providerMarkets.length > 0) {
    try {
      normalized = normalizeWithSchedule(await loadNflSchedule(), true);
    } catch (error) {
      console.error("NFL schedule fallback unavailable", error);
      normalized = normalizeWithSchedule(null, true);
    }
  }

  const executableNormalized = normalized.filter(
    (item) =>
      (item.market.yesAskBps ?? 0) > 0 ||
      (item.market.noAskBps ?? 0) > 0,
  );
  // Complete the pair after the executable-price gate. Kalshi can publish a
  // nominal second team outcome with no book while the opponent's NO side is
  // fully tradable. Treat that real NO book as the missing team's executable
  // moneyline rather than silently dropping one side of the game.
  const modeled = completeMoneylinePairs(executableNormalized);
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

  // Do not launch every prop model at once. A full NFL slate can contain
  // hundreds of contracts, and request-time injury/projection enrichment can
  // otherwise create enough simultaneous fetch/JSON work to exhaust the V8
  // heap and restart the Railway process.
  const models = await mapWithConcurrency(
    modeled,
    12,
    async (item) => {
      const liveKey =
        item.liveGame?.state === "in"
          ? `:${item.liveGame.period}:${item.liveGame.clock}:${item.liveGame.home.score}:${item.liveGame.away.score}`
          : ":pregame";
      // Model probability is intentionally independent from the current
      // executable market price. Odds changes should move edge/value, not
      // silently recompute Lynerva's own probability.
      const key = `${item.canonical.key}${liveKey}`;
      const cached = modelSnapshotCache.get(key);
      const playerMarket = ![
        "moneyline",
        "spread",
        "game_total",
      ].includes(item.canonical.family);
      const modelCacheTtl =
        item.liveGame?.state === "in"
          ? 15_000
          : playerMarket
            ? 90_000
            : 5 * 60_000;
      if (cached && Date.now() - cached.storedAt < modelCacheTtl) {
        return cached.estimate;
      }
      const estimate = await estimateMarket(
        item.canonical,
        item.scheduleGame,
        item.liveGame,
      );
      modelSnapshotCache.set(key, { estimate, storedAt: Date.now() });
      return estimate;
    },
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

      const injuryPlayBps =
        !live ? model.components?.injuryPlayProbabilityBps ?? null : null;
      const currentFairYesBps =
        market.yesBidBps !== null && market.yesAskBps !== null
          ? Math.round((market.yesBidBps + market.yesAskBps) / 2)
          : market.lastPriceBps ??
            market.yesAskBps ??
            market.yesBidBps ??
            model.probabilityBps;
      const dnpAdjustedProbabilityBps =
        blendConditionalWithDnpFairValueBps({
          conditionalProbabilityBps: model.probabilityBps,
          playProbabilityBps: injuryPlayBps,
          dnpFairValueBps: currentFairYesBps,
        });
      const pricedModel =
        injuryPlayBps !== null && model.components
          ? {
              ...model,
              probabilityBps: dnpAdjustedProbabilityBps,
              factors: [
                ...model.factors,
                currentFairYesBps !== null
                  ? "Kalshi DNP branch: estimated at current fair value " +
                    (currentFairYesBps / 100).toFixed(1) +
                    "%. A true DNP is not modeled as an automatic binary loss; availability risk instead reduces the portion of the edge that depends on actual player statistics."
                  : "Kalshi DNP branch: no current fair-value estimate was available.",
              ],
              components: {
                ...model.components,
                injuryDnpSettlementBps: currentFairYesBps,
              },
            }
          : model;

      // Kalshi generally settles a true DNP at an Exchange-determined scalar
      // fair price rather than treating it as an automatic binary loss. The
      // injury model therefore prices the play branch from football usage and
      // uses the current fair market value as a neutral estimate for the DNP
      // branch. Once the player participates, actual accumulated stats govern.
      // KXNFLGAME lists one YES contract per team. For moneylines, price
      // that explicit team outcome only; the NO side is just the opponent's
      // duplicated moneyline and would create confusing duplicate picks.
      const side =
        item.canonical.family === "moneyline"
          ? moneylineYesSide({
              probabilityBps: dnpAdjustedProbabilityBps,
              yesAskBps: market.yesAskBps,
            })
          : bestExecutableSide({
              probabilityBps: dnpAdjustedProbabilityBps,
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

      const roi =
        side.probabilityBps !== null && side.priceBps !== null
          ? expectedRoi(side.probabilityBps, side.priceBps)
          : null;
      const score = lynervaScore({
        probabilityBps: side.probabilityBps,
        edgeBps: side.edgeBps,
        priceBps: side.priceBps,
        expectedRoi: roi,
        reliabilityBps: model.reliabilityBps,
        seasonHits: model.evidence.seasonHits,
        seasonGames: model.evidence.seasonGames,
        last10Hits: model.evidence.last10Hits,
        sampleSize: model.evidence.sampleSize,
        recommendedSide: side.side,
        liquidityCents: market.liquidityCents,
        volumeCents: market.volumeCents,
        spreadBps,
        ageSeconds,
      });

      return {
        ...market,
        isLive: live,
        canonical: item.canonical,
        model: pricedModel,
        recommendedSide: side.side,
        recommendedProbabilityBps: side.probabilityBps,
        executablePriceBps: side.priceBps,
        edgeBps: side.edgeBps,
        expectedRoi: roi,
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
        lynervaScore: score?.score ?? null,
        scoreBreakdown: score?.breakdown ?? null,
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
  if (warmSnapshot && now - warmSnapshot.storedAt < 45_000) {
    return warmSnapshot.payload;
  }

  if (warmSnapshot) {
    void refreshSnapshot();
    return warmSnapshot.payload;
  }

  // A cold model build can take several seconds because it may need external
  // projection, injury, and schedule data. Start that work once, but do not
  // make every browser request wait indefinitely for it. If the first build
  // misses the fast-response budget, return an empty transient snapshot and
  // let the in-flight refresh populate the process cache for the next request.
  // The client retries, so cards appear as soon as the warm snapshot exists
  // instead of aborting the request at the browser timeout.
  const coldRefresh = refreshSnapshot();
  const fastFallback = new Promise<MarketsPayload>((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        opportunities: [],
        providers: [],
        fetchedAt: new Date().toISOString(),
        fixtureMode: false,
      });
    }, 2_500);
    timer.unref?.();
  });

  return Promise.race([coldRefresh, fastFallback]);
}

export async function getFreshMarketOpportunities() {
  return refreshSnapshot();
}

function normalizeMatchupKey(value: string) {
  return value
    .split(/[^A-Za-z]+/)
    .map((team) => team.trim().toUpperCase())
    .filter(Boolean)
    .map((team) =>
      team === "WSH" ? "WAS" : team === "JAC" ? "JAX" : team === "LA" ? "LAR" : team,
    )
    .toSorted()
    .join("-");
}

function filterPayloadToMatchup(
  payload: MarketsPayload,
  matchup: string,
): MarketsPayload {
  return {
    ...payload,
    opportunities: payload.opportunities.filter(
      (market) =>
        normalizeMatchupKey(market.canonical?.matchup ?? "") === matchup,
    ),
  };
}

async function refreshMatchupSnapshot(matchup: string) {
  const existing = matchupRefreshPromises.get(matchup);
  if (existing) return existing;

  const promise = computeMarketOpportunities(matchup)
    .then((payload) => {
      matchupSnapshots.set(matchup, { payload, storedAt: Date.now() });
      return payload;
    })
    .finally(() => {
      matchupRefreshPromises.delete(matchup);
    });
  matchupRefreshPromises.set(matchup, promise);
  return promise;
}

export async function getMarketOpportunitiesForMatchup(
  matchup: string,
): Promise<MarketsPayload> {
  const key = normalizeMatchupKey(matchup);
  if (!key) {
    return {
      opportunities: [],
      providers: [],
      fetchedAt: new Date().toISOString(),
      fixtureMode: false,
    };
  }

  // The global feed is already computed by the normal market refresh loop.
  // Reuse it for game pages instead of rebuilding projections, injury context,
  // and source consensus when someone clicks a game. This restores the
  // near-instant game view while a scoped refresh happens in the background.
  if (warmSnapshot) {
    const filtered = filterPayloadToMatchup(warmSnapshot.payload, key);
    if (filtered.opportunities.length > 0) {
      if (!matchupRefreshPromises.has(key)) {
        void refreshMatchupSnapshot(key);
      }
      return filtered;
    }
  }

    const cached = matchupSnapshots.get(key);
  if (cached && Date.now() - cached.storedAt < 45_000) {
    return cached.payload;
  }
  if (cached) {
    void refreshMatchupSnapshot(key);
    return cached.payload;
  }

  return refreshMatchupSnapshot(key);
}

export function marketKey(market: ProviderMarket) {
  return `${market.platform}:${market.platformMarketId}:${market.platformOutcomeId ?? "yes"}`;
}
