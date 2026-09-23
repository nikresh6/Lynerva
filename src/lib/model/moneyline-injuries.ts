import "server-only";

import {
  getWeeklyProjectionStatSnapshots,
  type ProjectionStatistic,
} from "./external-projections";
import type { MoneylineInjuryInput } from "./moneyline-injury-scenarios";
import { getTeamRoster, type TeamRosterPlayer } from "@/lib/nfl/player-visuals";
import { getPregamePlayerAvailability } from "@/lib/nfl/pregame-injuries";
import { findPublicPlayerSeasonHistory } from "@/lib/nfl/history";
import { clamp } from "@/lib/utils";

type ProjectionProfile = Partial<Record<ProjectionStatistic, number>>;

const CACHE_MS = 90_000;
const cache = new Map<
  string,
  { expiresAt: number; promise: Promise<MoneylineInjuryInput[]> }
>();

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle] ?? null
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function projectionProfiles(
  snapshots: Awaited<ReturnType<typeof getWeeklyProjectionStatSnapshots>>,
) {
  const points = new Map<string, Map<ProjectionStatistic, number[]>>();
  for (const snapshot of snapshots) {
    const key = normalizePerson(snapshot.playerKey || snapshot.playerName);
    if (!key) continue;
    const stats = points.get(key) ?? new Map<ProjectionStatistic, number[]>();
    const values = stats.get(snapshot.statistic) ?? [];
    values.push(snapshot.value);
    stats.set(snapshot.statistic, values);
    points.set(key, stats);
  }

  return new Map(
    [...points.entries()].map(([player, stats]) => [
      player,
      Object.fromEntries(
        [...stats.entries()].flatMap(([statistic, values]) => {
          const value = median(values);
          return value === null ? [] : [[statistic, value]];
        }),
      ) as ProjectionProfile,
    ]),
  );
}

function skillVolume(profile: ProjectionProfile) {
  return (
    (profile.rushing_yards ?? 0) +
    (profile.receiving_yards ?? 0) +
    (profile.receptions ?? 0) * 3 +
    ((profile.rushing_touchdowns ?? 0) +
      (profile.receiving_touchdowns ?? 0) +
      (profile.touchdowns ?? 0)) *
      30
  );
}

function quarterbackValue(profile: ProjectionProfile) {
  return (
    (profile.passing_yards ?? 0) / 55 +
    (profile.passing_touchdowns ?? 0) * 1.8 -
    (profile.passing_interceptions ?? 0) * 0.8 +
    (profile.rushing_yards ?? 0) / 50 +
    (profile.rushing_touchdowns ?? 0) * 1.2
  );
}

function quarterbackImpact(
  starter: ProjectionProfile,
  backup: ProjectionProfile | null,
) {
  const passingYards = starter.passing_yards ?? 0;
  if (passingYards < 100) return 0;

  const starterValue = quarterbackValue(starter);
  const backupHasRealProjection = (backup?.passing_yards ?? 0) >= 75;
  if (backupHasRealProjection && backup) {
    return clamp(starterValue - quarterbackValue(backup), 1.75, 5.5);
  }

  // A non-starting QB often has no weekly projection. In that case use a
  // deliberately broad, volume-based replacement prior rather than pretending
  // zero projected attempts means zero backup ability.
  return clamp(
    2.25 + (passingYards - 180) / 55 + (starter.rushing_yards ?? 0) / 120,
    2.25,
    5,
  );
}

function skillImpact(profile: ProjectionProfile) {
  const volume =
    (profile.rushing_yards ?? 0) + (profile.receiving_yards ?? 0);
  const touchdowns =
    (profile.rushing_touchdowns ?? 0) +
    (profile.receiving_touchdowns ?? 0) +
    (profile.touchdowns ?? 0);
  if (volume < 35 && touchdowns < 0.2) return 0;
  return clamp(0.25 + volume / 170 + touchdowns * 0.55, 0.3, 1.6);
}

function relevantPlayers(
  roster: TeamRosterPlayer[],
  profiles: Map<string, ProjectionProfile>,
) {
  const withProfile = roster.map((player) => ({
    player,
    profile: profiles.get(normalizePerson(player.fullName)) ?? {},
  }));
  const quarterbacks = withProfile
    .filter(({ player }) => player.position === "QB")
    .toSorted(
      (a, b) =>
        (b.profile.passing_yards ?? 0) - (a.profile.passing_yards ?? 0),
    )
    .slice(0, 4);
  const skill = withProfile
    .filter(({ player }) =>
      player.position === "RB" ||
      player.position === "WR" ||
      player.position === "TE",
    )
    .toSorted((a, b) => skillVolume(b.profile) - skillVolume(a.profile))
    .slice(0, 4);

  return {
    quarterbacks,
    skill,
  };
}

function recentQuarterbackUsage(
  history: Awaited<ReturnType<typeof findPublicPlayerSeasonHistory>>,
) {
  const games = history.values.slice(0, 4);
  return {
    attempts: games.reduce(
      (sum, game) => sum + Math.max(0, game.passingAttempts ?? 0),
      0,
    ),
    averagePassingYards: games.length
      ? games.reduce((sum, game) => sum + Math.max(0, game.value), 0) /
        games.length
      : 0,
  };
}

async function collectTeamInjuries(input: {
  team: string;
  side: MoneylineInjuryInput["side"];
  profiles: Map<string, ProjectionProfile>;
  season: number;
  espnGameId?: string | null;
}) {
  const roster = await getTeamRoster(input.team);
  const relevant = relevantPlayers(roster, input.profiles);
  const quarterbackUsage = await Promise.all(
    relevant.quarterbacks.map(async (candidate) => ({
      player: candidate.player.fullName,
      ...(recentQuarterbackUsage(
        await findPublicPlayerSeasonHistory(
          candidate.player.fullName,
          "passing_yards",
          input.season,
        ),
      )),
    })),
  );
  const primaryQuarterback = quarterbackUsage.toSorted(
    (first, second) =>
      second.attempts - first.attempts ||
      second.averagePassingYards - first.averagePassingYards,
  )[0];
  const projectedBackup = relevant.quarterbacks.find(
    (candidate) => candidate.player.fullName !== primaryQuarterback?.player,
  );
  const candidates = [
    ...relevant.quarterbacks.map((candidate) => {
      const usage = quarterbackUsage.find(
        (row) => row.player === candidate.player.fullName,
      );
      const isEstablishedStarter =
        candidate.player.fullName === primaryQuarterback?.player &&
        (primaryQuarterback.attempts >= 15 ||
          primaryQuarterback.averagePassingYards >= 100);
      const profile =
        (candidate.profile.passing_yards ?? 0) >= 100
          ? candidate.profile
          : isEstablishedStarter
            ? {
                ...candidate.profile,
                passing_yards: Math.max(
                  150,
                  usage?.averagePassingYards ?? 0,
                ),
              }
            : candidate.profile;
      return {
        ...candidate,
        impact: quarterbackImpact(profile, projectedBackup?.profile ?? null),
      };
    }),
    ...relevant.skill.map((candidate) => ({
      ...candidate,
      impact: skillImpact(candidate.profile),
    })),
  ].filter((candidate) => candidate.impact > 0);

  const availability = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      availability: await getPregamePlayerAvailability({
        subject: candidate.player.fullName,
        espnGameId: input.espnGameId ?? null,
      }),
    })),
  );

  return availability.flatMap(({ player, impact, availability: state }) => {
    if (!state) return [];
    const position = player.position ?? "";
    const material =
      position === "QB"
        ? state.playProbability < 0.975 || state.expectedUsageIfActive < 0.96
        : state.risk === "out" ||
          state.risk === "high" ||
          state.playProbability < 0.82;
    if (!material) return [];

    return [{
      player: player.fullName,
      team: input.team,
      position,
      side: input.side,
      status: state.status,
      playProbability: state.playProbability,
      expectedUsageIfActive: state.expectedUsageIfActive,
      impactPoints: impact,
      sources: state.sources,
    } satisfies MoneylineInjuryInput];
  });
}

async function computeMoneylineInjuryInputs(input: {
  subjectTeam: string;
  opponentTeam: string;
  season: number;
  week: number;
  espnGameId?: string | null;
}) {
  try {
    const [snapshots, subjectRoster, opponentRoster] = await Promise.all([
      getWeeklyProjectionStatSnapshots(input.season, input.week),
      getTeamRoster(input.subjectTeam),
      getTeamRoster(input.opponentTeam),
    ]);
    // Prime the shared roster cache above, then both collectors reuse it. The
    // weekly source pages and injury/news payloads are also independently
    // cached, preventing one network fan-out per moneyline listing.
    void subjectRoster;
    void opponentRoster;
    const profiles = projectionProfiles(snapshots);
    const [subject, opponent] = await Promise.all([
      collectTeamInjuries({
        team: input.subjectTeam,
        side: "subject",
        profiles,
        season: input.season,
        espnGameId: input.espnGameId,
      }),
      collectTeamInjuries({
        team: input.opponentTeam,
        side: "opponent",
        profiles,
        season: input.season,
        espnGameId: input.espnGameId,
      }),
    ]);
    return [...subject, ...opponent]
      .toSorted((a, b) => b.impactPoints - a.impactPoints)
      .slice(0, 6);
  } catch (error) {
    console.error("Moneyline injury context unavailable", error);
    return [];
  }
}

export function getMoneylineInjuryInputs(input: {
  subjectTeam: string;
  opponentTeam: string;
  season: number;
  week: number;
  espnGameId?: string | null;
}) {
  const key = [
    input.subjectTeam,
    input.opponentTeam,
    input.season,
    input.week,
    input.espnGameId ?? "no-game",
  ].join(":");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = computeMoneylineInjuryInputs(input);
  cache.set(key, { expiresAt: Date.now() + CACHE_MS, promise });
  promise.catch(() => cache.delete(key));
  return promise;
}
