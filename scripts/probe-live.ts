import { fetchKalshiNflMarkets } from "../src/lib/kalshi";
import { fetchPolymarketNflMarkets } from "../src/lib/polymarket";
import { getLiveNflGames } from "../src/lib/nfl/live";
import { normalizeMarket } from "../src/lib/markets/normalize";

async function main() {
  const games = await getLiveNflGames();
  const current = games.find((game) => game.state === "in") ?? games.find((game) => game.state === "pre");
  const matchup = current ? [current.home.team, current.away.team].toSorted().join("-") : null;
  console.log("CURRENT", current, matchup);

  const providers = await Promise.all([
    fetchKalshiNflMarkets(),
    fetchPolymarketNflMarkets(),
  ]);

  const activeMatchups = new Set(
    games
      .filter((game) => game.seasonType === 2 && game.state !== "post")
      .map((game) => [game.home.team, game.away.team].toSorted().join("-")),
  );

  for (const provider of providers) {
    const allNormalized = provider.markets
      .map((market) => ({ market, canonical: normalizeMarket(market) }))
      .filter(
        (item) =>
          item.canonical?.matchup &&
          activeMatchups.has(item.canonical.matchup),
      );
    const familyCounts = allNormalized.reduce<Record<string, number>>(
      (counts, item) => {
        const family = item.canonical?.family ?? "other";
        counts[family] = (counts[family] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const normalized = allNormalized
      .filter((item) => item.canonical?.matchup === matchup)
      .slice(0, 30);
    console.log(
      provider.provider,
      "raw",
      provider.markets.length,
      "slateMatched",
      allNormalized.length,
      "familyCounts",
      familyCounts,
      "currentGameSamples",
      normalized.map((item) => ({
        id: item.market.platformMarketId,
        event: item.market.eventTitle,
        title: item.market.marketTitle,
        outcome: item.market.outcomeLabel,
        rules: item.market.resolutionRules?.slice(0, 180),
        yesBid: item.market.yesBidBps,
        yesAsk: item.market.yesAskBps,
        noBid: item.market.noBidBps,
        noAsk: item.market.noAskBps,
        canonical: item.canonical,
      })),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
