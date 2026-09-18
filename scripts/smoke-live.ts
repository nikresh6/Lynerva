type MarketOpportunity = {
  platform: "kalshi" | "polymarket";
  marketTitle: string;
  canonical: {
    matchup: string | null;
    family: string;
  } | null;
  recommendedSide: "yes" | "no" | null;
  recommendedProbabilityBps: number | null;
  executablePriceBps: number | null;
  edgeBps: number | null;
  opportunityScore: number | null;
  isLive: boolean;
};

type MarketsPayload = {
  opportunities: MarketOpportunity[];
  providers: Array<{
    provider: "kalshi" | "polymarket";
    markets: unknown[];
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

  const payload = (await marketsResponse.json()) as MarketsPayload;
  const livePayload = (await liveResponse.json()) as { games: LiveGame[] };

  const picks = payload.opportunities
    .filter(
      (market) =>
        market.recommendedSide !== null &&
        market.recommendedProbabilityBps !== null &&
        market.executablePriceBps !== null &&
        market.executablePriceBps > 0 &&
        market.executablePriceBps < 10_000 &&
        market.edgeBps !== null &&
        market.edgeBps > 0,
    )
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
        providers: payload.providers.map((provider) => ({
          provider: provider.provider,
          acceptedMarkets: provider.markets.length,
          error: provider.error,
        })),
        opportunities: payload.opportunities.length,
        gameMarkets: gameMarkets.length,
        topPicks: picks.length,
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

  if (payload.opportunities.length === 0) {
    throw new Error("Live smoke failed: zero eligible NFL opportunities.");
  }
  if (gameMarkets.length === 0) {
    throw new Error("Live smoke failed: zero current NFL game markets.");
  }
  if (picks.length === 0) {
    throw new Error("Live smoke failed: zero positive-edge model-backed picks.");
  }
  if (payload.providers.every((provider) => provider.markets.length === 0)) {
    throw new Error(
      "Live smoke failed: both market providers returned zero accepted markets.",
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
