import type { Metadata } from "next";
import { GameBoard } from "@/components/game-board";
import { getActiveNflSlateGames } from "@/lib/nfl/live";

export const metadata: Metadata = { title: "NFL Games" };
export const dynamic = "force-dynamic";

export default async function GamesPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string | string[] }>;
}) {
  const params = await searchParams;
  const requestedGame = Array.isArray(params.game) ? params.game[0] : params.game;
  const initialGames = await getActiveNflSlateGames();

  return (
    <GameBoard
      initialGames={initialGames}
      requestedGame={requestedGame ?? ""}
    />
  );
}
