import { isTopOpportunity } from "../src/lib/markets/eligibility";
import { getFreshMarketOpportunities } from "../src/lib/markets/service";
import { getLiveNflGames } from "../src/lib/nfl/live";

async function main() {
  
  const started = Date.now();
  const [payload, games] = await Promise.all([
    getFreshMarketOpportunities(),
    getLiveNflGames(),
  ]);
  
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
  
  const currentGameMatchups = new Set(
    payload.opportunities
      .map((market) => market.canonical?.matchup)
      .filter((value): value is string => Boolean(value)),
  );
  
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
        matchups: [...currentGameMatchups].slice(0, 20),
        espnGames: games.map((game) => ({
          name: game.name,
          state: game.state,
          status: game.status,
          startsAt: game.startsAt,
        })),
        samples: picks.slice(0, 8).map((pick) => ({
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
    throw new Error("Live smoke failed: both market providers returned zero accepted markets.");
  }
  
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
