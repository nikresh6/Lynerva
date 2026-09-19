import type { LiveNflGame } from "./live";

function canonicalTeamCode(code: string) {
  const upper = code.toUpperCase();
  if (upper === "WSH") return "WAS";
  if (upper === "JAC") return "JAX";
  if (upper === "LA") return "LAR";
  return upper;
}

function canonicalMatchup(teams: string[]) {
  return teams.map(canonicalTeamCode).toSorted().join("-");
}

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
        canonicalMatchup([game.home.team, game.away.team]) === canonicalMatchup(matchup.split("-")),
    ) ?? null
  );
}
