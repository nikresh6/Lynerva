import type { Metadata } from "next";
import { GameBoard } from "@/components/game-board";
import { buildMarketClientPayload } from "@/lib/markets/client-payload";
import { getMarketOpportunitiesForMatchup } from "@/lib/markets/service";
import { getActiveNflSlateGames } from "@/lib/nfl/live";

export const metadata: Metadata = { title: "NFL Games" };
export const dynamic = "force-dynamic";

function gameKey(away: string, home: string) {
  return [away, home]
    .map((team) => {
      const upper = team.toUpperCase();
      if (upper === "WSH") return "WAS";
      if (upper === "JAC") return "JAX";
      if (upper === "LA") return "LAR";
      return upper;
    })
    .toSorted()
    .join("-");
}

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedGame = Array.isArray(params.game) ? params.game[0] : params.game;
  const initialGames = await getActiveNflSlateGames();
  const slate = initialGames
    .filter((game) => game.state !== "post")
    .toSorted(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  const initialGameKey =
    requestedGame?.trim() ||
    (slate[0] ? gameKey(slate[0].away.team, slate[0].home.team) : "");

  const initialMarkets = initialGameKey
    ? buildMarketClientPayload(
        await getMarketOpportunitiesForMatchup(initialGameKey),
      ).opportunities
    : [];

  return (
    <GameBoard
      initialGames={initialGames}
      requestedGame={requestedGame ?? ""}
      initialOpportunities={initialMarkets}
    />
  );
}
