export interface DimersProjection {
  player: string;
  position?: "QB" | "RB" | "WR" | "TE";
  passingYards?: number;
  rushingYards?: number;
  receptions?: number;
  receivingYards?: number;
  totalTouchdowns?: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegative(value: unknown) {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Dimers moved its NFL projections from server-rendered table rows to the
 * public JSON feed used by its own browser app. Parse it defensively and only
 * accept the exact requested season/week so stale rounds cannot leak in.
 */
export function parseDimersProjectionResponse(
  payload: unknown,
  season: number,
  week: number,
) {
  if (!Array.isArray(payload)) return [];

  const projections: DimersProjection[] = [];
  for (const rawGame of payload) {
    const game = record(rawGame);
    if (!game) continue;
    const match = record(game.MatchData ?? game.matchData) ?? game;
    const responseSeason = finite(
      match.Season ?? match.season ?? game.Season ?? game.season,
    );
    const responseWeek = finite(
      match.RoundNumber ??
        match.roundNumber ??
        match.Round ??
        match.round ??
        game.RoundNumber ??
        game.roundNumber,
    );
    const sport = text(match.Sport ?? match.sport ?? game.Sport ?? game.sport);
    if (
      responseSeason !== season ||
      responseWeek !== week ||
      (sport && sport.toUpperCase() !== "NFL")
    ) {
      continue;
    }

    const box =
      record(
        game.projBoxScore ??
          game.projectedBoxScore ??
          match.projBoxScore ??
          match.projectedBoxScore,
      ) ?? {};
    const players = [
      ...(Array.isArray(box.home) ? box.home : []),
      ...(Array.isArray(box.away) ? box.away : []),
      ...(Array.isArray(box.Home) ? box.Home : []),
      ...(Array.isArray(box.Away) ? box.Away : []),
    ];

    for (const rawPlayer of players) {
      const player = record(rawPlayer);
      if (!player) continue;
      const name =
        text(player.playerName ?? player.full_name ?? player.fullName) ||
        [text(player.first_name ?? player.firstName), text(player.last_name ?? player.lastName)]
          .filter(Boolean)
          .join(" ");
      if (!name) continue;

      const positionText = text(player.position).toUpperCase();
      const position = ["QB", "RB", "WR", "TE"].includes(positionText)
        ? (positionText as DimersProjection["position"])
        : undefined;
      const anytimeTouchdown = finite(
        player.anytimeTD ?? player.anytimeTd ?? player.anytimeTouchdown,
      );
      const touchdownProbability =
        anytimeTouchdown !== null && anytimeTouchdown > 1
          ? anytimeTouchdown / 100
          : anytimeTouchdown;
      const totalTouchdowns =
        touchdownProbability !== null &&
        touchdownProbability > 0 &&
        touchdownProbability < 1
          ? -Math.log(1 - touchdownProbability)
          : undefined;

      const projection: DimersProjection = {
        player: name,
        position,
        passingYards: nonNegative(player.passYds ?? player.passingYards),
        rushingYards: nonNegative(player.rushYds ?? player.rushingYards),
        receptions: nonNegative(player.rec ?? player.receptions),
        receivingYards: nonNegative(player.recYds ?? player.receivingYards),
        totalTouchdowns,
      };
      if (
        projection.passingYards === undefined &&
        projection.rushingYards === undefined &&
        projection.receptions === undefined &&
        projection.receivingYards === undefined &&
        projection.totalTouchdowns === undefined
      ) {
        continue;
      }
      projections.push(projection);
    }
  }

  return projections;
}
