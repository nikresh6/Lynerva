import "server-only";

import { getDb } from "@/db";
import { nflGames, nflPlayers, playerGameStats } from "@/db/schema";
import { runSourceLearningLoop } from "@/lib/model/source-learning";

type CsvRow = Record<string, string>;

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseCsv(text: string) {
  const lines = text.replaceAll("\r\n", "\n").split("\n").filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line): CsvRow => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function numberOrNull(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchCsv(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Lynerva/1.0 historical-ingestion" },
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`nflverse returned ${response.status} for ${url}`);
  return parseCsv(await response.text());
}

function kickoff(row: CsvRow) {
  const date = row.gameday;
  const time = row.gametime || "12:00";
  const parsed = new Date(`${date}T${time}:00-05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function ingestNflverseSeason(season: number) {
  if (season < 1999 || season > new Date().getUTCFullYear() + 1) {
    throw new Error("Invalid NFL season");
  }
  const [games, stats] = await Promise.all([
    fetchCsv("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"),
    fetchCsv(
      `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`,
    ),
  ]);
  const db = getDb();
  const seasonGames = games.filter((row) => Number(row.season) === season);
  const validGameIds = new Set<string>();
  const gameByTeamWeek = new Map<string, string>();
  let gamesStored = 0;
  let playersStored = 0;
  let statsStored = 0;

  for (const row of seasonGames) {
    const startsAt = kickoff(row);
    if (!row.game_id || !startsAt || !row.home_team || !row.away_team) continue;
    validGameIds.add(row.game_id);
    gameByTeamWeek.set(
      `${row.week}:${row.home_team}:${row.away_team}`,
      row.game_id,
    );
    gameByTeamWeek.set(
      `${row.week}:${row.away_team}:${row.home_team}`,
      row.game_id,
    );
    await db
      .insert(nflGames)
      .values({
        id: row.game_id,
        season,
        week: numberOrNull(row.week),
        seasonType: row.game_type || "REG",
        kickoffAt: startsAt,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        homeScore: numberOrNull(row.home_score),
        awayScore: numberOrNull(row.away_score),
        status: row.result ? "final" : "scheduled",
        stadium: row.stadium || null,
        roof: row.roof || null,
        surface: row.surface || null,
      })
      .onConflictDoUpdate({
        target: nflGames.id,
        set: {
          homeScore: numberOrNull(row.home_score),
          awayScore: numberOrNull(row.away_score),
          status: row.result ? "final" : "scheduled",
          kickoffAt: startsAt,
        },
      });
    gamesStored += 1;
  }

  for (let index = 0; index < stats.length; index += 25) {
    const chunk = stats.slice(index, index + 25);
    await Promise.all(chunk.map(async (row) => {
      const playerId = row.player_id;
      const team = row.recent_team || row.team;
      const gameId =
        row.game_id ||
        gameByTeamWeek.get(`${row.week}:${team}:${row.opponent_team}`) ||
        "";
      const name = row.player_display_name || row.player_name;
      if (!playerId || !gameId || !name || !team || !validGameIds.has(gameId)) return;
      await db
        .insert(nflPlayers)
        .values({
          id: playerId,
          gsisId: playerId,
          fullName: name,
          position: row.position || null,
          team,
          active: true,
        })
        .onConflictDoUpdate({
          target: nflPlayers.id,
          set: { fullName: name, position: row.position || null, team },
        });
      playersStored += 1;
      await db
        .insert(playerGameStats)
        .values({
          playerId,
          gameId,
          team,
          opponent: row.opponent_team || "UNK",
          passingYards: numberOrNull(row.passing_yards),
          passingAttempts: numberOrNull(row.attempts),
          passingTouchdowns: numberOrNull(row.passing_tds),
          rushingYards: numberOrNull(row.rushing_yards),
          rushingAttempts: numberOrNull(row.carries),
          rushingTouchdowns: numberOrNull(row.rushing_tds),
          receivingYards: numberOrNull(row.receiving_yards),
          targets: numberOrNull(row.targets),
          receptions: numberOrNull(row.receptions),
          receivingTouchdowns: numberOrNull(row.receiving_tds),
          fantasyPoints: numberOrNull(row.fantasy_points),
        })
        .onConflictDoUpdate({
          target: [playerGameStats.playerId, playerGameStats.gameId],
          set: {
            passingYards: numberOrNull(row.passing_yards),
            passingAttempts: numberOrNull(row.attempts),
            passingTouchdowns: numberOrNull(row.passing_tds),
            rushingYards: numberOrNull(row.rushing_yards),
            rushingAttempts: numberOrNull(row.carries),
            rushingTouchdowns: numberOrNull(row.rushing_tds),
            receivingYards: numberOrNull(row.receiving_yards),
            targets: numberOrNull(row.targets),
            receptions: numberOrNull(row.receptions),
            receivingTouchdowns: numberOrNull(row.receiving_tds),
            fantasyPoints: numberOrNull(row.fantasy_points),
          },
        });
      statsStored += 1;
    }));
  }
  const learning = await runSourceLearningLoop(season);
  return {
    season,
    gamesStored,
    playersStored,
    statsStored,
    learning,
  };
}
