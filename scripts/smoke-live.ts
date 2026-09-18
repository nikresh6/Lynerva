import { buildBestAvailableCombination } from "../src/lib/builder";
import {
  isBuilderEligibleOpportunity,
  isTopOpportunity,
} from "../src/lib/markets/eligibility";
import type { MarketOpportunity } from "../src/lib/markets/types";

type MarketsPayload = {
  opportunities: MarketOpportunity[];
  providers: Array<{
    provider: "kalshi" | "polymarket";
    count: number;
    fetchedAt: string;
    error: string | null;
  }>;
};

type LiveGame = {
  name: string;
  state: string;
  status: string;
  startsAt: string;
  home: { team: string; score: number };
  away: { team: string; score: number };
};

async function main() {
  const baseUrl = process.env.LYNERVA_SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
  const started = Date.now();

  const pageChecks = await Promise.all(
    ["/", "/live", "/builder", "/tracker", "/sign-in"].map(async (path) => {
      const pageStarted = Date.now();
      const response = await fetch(`${baseUrl}${path}`, {
        redirect: "manual",
      });
      return { path, status: response.status, elapsedMs: Date.now() - pageStarted };
    }),
  );
  const brokenPage = pageChecks.find(
    ({ status }) => status >= 500 || status < 200,
  );
  if (brokenPage) {
    throw new Error(
      `Page smoke failed: ${brokenPage.path} returned ${brokenPage.status}.`,
    );
  }

  const apiStarted = Date.now();
  const [marketsResponse, liveResponse] = await Promise.all([
    fetch(`${baseUrl}/api/markets`, { cache: "no-store" }),
    fetch(`${baseUrl}/api/live-nfl`, { cache: "no-store" }),
  ]);

  if (!marketsResponse.ok) {
    throw new Error(
      `Markets API returned ${marketsResponse.status}: ${await marketsResponse.text()}`,
    );
  }
  if (!liveResponse.ok) {
    throw new Error(
      `Live NFL API returned ${liveResponse.status}: ${await liveResponse.text()}`,
    );
  }

  const apiElapsedMs = Date.now() - apiStarted;
  const payload = (await marketsResponse.json()) as MarketsPayload;
  const livePayload = (await liveResponse.json()) as { games: LiveGame[] };

  const warmStarted = Date.now();
  const warmResponse = await fetch(`${baseUrl}/api/markets`, {
    cache: "no-store",
  });
  const warmApiElapsedMs = Date.now() - warmStarted;
  if (!warmResponse.ok) {
    throw new Error(`Warm Markets API returned ${warmResponse.status}.`);
  }

  const picks = payload.opportunities
    .filter(isTopOpportunity)
    .toSorted(
      (a, b) =>
        (b.opportunityScore ?? -Infinity) -
        (a.opportunityScore ?? -Infinity),
    );

  const gameMarkets = payload.opportunities.filter((market) =>
    ["moneyline", "spread", "game_total"].includes(
      market.canonical?.family ?? "",
    ),
  );
  const playerPropMarkets = payload.opportunities.filter((market) =>
    [
      "passing_yards",
      "passing_touchdowns",
      "rushing_yards",
      "receiving_yards",
      "receptions",
      "touchdowns",
    ].includes(market.canonical?.family ?? ""),
  );
  const livePicks = picks.filter((market) => market.isLive);
  const livePricedMarkets = payload.opportunities.filter(
    (market) =>
      market.isLive &&
      market.recommendedProbabilityBps !== null &&
      market.executablePriceBps !== null &&
      market.executablePriceBps > 0 &&
      market.executablePriceBps < 10_000,
  );
  const pregamePicks = picks.filter((market) => !market.isLive);
  const builderMarkets = payload.opportunities.filter(
    isBuilderEligibleOpportunity,
  );
  const defaultBuild = buildBestAvailableCombination(builderMarkets, {
    minReturn: 3,
    maxReturn: 5,
    maxLegs: 4,
    platform: "either",
    live: "all",
    excludeSameGame: true,
  });
  const pregameBuild = buildBestAvailableCombination(builderMarkets, {
    minReturn: 3,
    maxReturn: 5,
    maxLegs: 4,
    platform: "either",
    live: "pregame",
    excludeSameGame: true,
  });
  const unsupportedPeriodMarkets = payload.opportunities.filter((market) =>
    /\b(?:1q|2q|3q|4q|1h|2h|first quarter|second quarter|third quarter|fourth quarter|first half|second half)\b/i.test(
      market.marketTitle,
    ),
  );

  const matchups = new Set(
    payload.opportunities
      .map((market) => market.canonical?.matchup)
      .filter((value): value is string => Boolean(value)),
  );

  const currentEspnGame = livePayload.games
    .filter((game) => game.state === "in" || game.state === "pre")
    .toSorted(
      (first, second) =>
        new Date(first.startsAt).getTime() - new Date(second.startsAt).getTime(),
    )[0];

  const currentEspnMatchup = currentEspnGame
    ? [currentEspnGame.home.team, currentEspnGame.away.team]
        .toSorted()
        .join("-")
    : null;

  console.log(
    JSON.stringify(
      {
        elapsedMs: Date.now() - started,
        pages: pageChecks,
        apiElapsedMs,
        warmApiElapsedMs,
        providers: payload.providers.map((provider) => ({
          provider: provider.provider,
          acceptedMarkets: provider.count,
          error: provider.error,
        })),
        opportunities: payload.opportunities.length,
        gameMarkets: gameMarkets.length,
        playerPropMarkets: playerPropMarkets.length,
        topPicks: picks.length,
        liveTopPicks: livePicks.length,
        livePricedMarkets: livePricedMarkets.length,
        pregameTopPicks: pregamePicks.length,
        builderEligible: builderMarkets.length,
        defaultBuilderWorks: Boolean(defaultBuild),
        pregameBuilderWorks: Boolean(pregameBuild),
        unsupportedPeriodMarkets: unsupportedPeriodMarkets.length,
        matchups: [...matchups].slice(0, 20),
        currentEspnGame,
        currentEspnMatchup,
        currentGameMapped:
          currentEspnMatchup === null ? null : matchups.has(currentEspnMatchup),
        samples: picks.slice(0, 10).map((pick) => ({
          platform: pick.platform,
          title: pick.marketTitle,
          matchup: pick.canonical?.matchup,
          family: pick.canonical?.family,
          side: pick.recommendedSide,
          price: pick.executablePriceBps,
          model: pick.recommendedProbabilityBps,
          edge: pick.edgeBps,
          live: pick.isLive,
        })),
      },
      null,
      2,
    ),
  );

  const slowPage = pageChecks.find((page) => page.elapsedMs > 1_500);
  if (slowPage) {
    throw new Error(
      `Page smoke failed: ${slowPage.path} took ${slowPage.elapsedMs}ms.`,
    );
  }
  if (apiElapsedMs > 6_000) {
    throw new Error(
      `Live smoke failed: cold market API took ${apiElapsedMs}ms.`,
    );
  }
  if (warmApiElapsedMs > 1_000) {
    throw new Error(
      `Live smoke failed: warm market API took ${warmApiElapsedMs}ms.`,
    );
  }
  if (Date.now() - started > 8_000) {
    throw new Error("Live smoke failed: full cold smoke exceeded 8 seconds.");
  }
  if (payload.opportunities.length === 0) {
    throw new Error("Live smoke failed: zero eligible NFL opportunities.");
  }
  if (gameMarkets.length === 0) {
    throw new Error("Live smoke failed: zero current NFL game markets.");
  }
  if (playerPropMarkets.length === 0) {
    throw new Error("Live smoke failed: zero regular-season player props were modeled.");
  }
  if (picks.length === 0) {
    throw new Error("Live smoke failed: zero quality model-backed top picks.");
  }
  if (currentEspnGame?.state === "in" && livePricedMarkets.length === 0) {
    throw new Error("Live smoke failed: live game exists but there are zero executable modeled live markets.");
  }
  if (pregamePicks.length === 0) {
    throw new Error("Live smoke failed: upcoming regular-season slate has zero quality pregame picks.");
  }
  if (!defaultBuild) {
    throw new Error("Live smoke failed: the default 3x-5x Builder could not construct a combination.");
  }
  if (!pregameBuild) {
    throw new Error("Live smoke failed: the 3x-5x Builder could not construct a pregame combination.");
  }
  if (unsupportedPeriodMarkets.length > 0) {
    throw new Error("Live smoke failed: unsupported quarter/half markets leaked into the feed.");
  }
  if (payload.providers.some((provider) => provider.count === 0)) {
    throw new Error(
      "Live smoke failed: Kalshi or Polymarket returned zero accepted markets.",
    );
  }
  if (currentEspnMatchup && !matchups.has(currentEspnMatchup)) {
    throw new Error(
      `Live smoke failed: current ESPN game ${currentEspnMatchup} is not mapped to any market.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
