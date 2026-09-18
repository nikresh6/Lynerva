import type { LiveNflGame } from "./live";

export function findCurrentRegularSeasonGame(
  matchup: string | null,
  games: LiveNflGame[],
) {
  if (!matchup) return null;
  return (
    games.find(
      (game) =>
        game.seasonType === 2 &&
        game.state !== "post" &&
        [game.home.team, game.away.team].toSorted().join("-") === matchup,
    ) ?? null
  );
}
