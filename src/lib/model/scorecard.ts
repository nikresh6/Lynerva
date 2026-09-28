import "server-only";

import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  marketListings,
  nflGames,
  nflPlayers,
  normalizedMarkets,
  playerGameStats,
  predictionResults,
  predictions,
  weeklyScorecardPicks,
} from "@/db/schema";
import { recommendedPredictionPerspective } from "./prediction-perspective";
import { settleLockedScorecardPredictions } from "./results";

const SCORECARD_BUCKET_LAUNCH_AT = new Date("2026-09-21T16:10:00.000Z");
const LOCK_SCAN_WINDOW_MS = 14 * 24 * 60 * 60_000;
const LOCK_LEAD_MS = 5 * 60_000;

type ScorecardBucket =
  | "tnf"
  | "sunday_noon"
  | "sunday_late"
  | "snf"
  | "mnf";

const BUCKET_RULES: Array<{
  id: ScorecardBucket;
  count: number;
  rankStart: number;
  label: string;
}> = [
  { id: "tnf", count: 1, rankStart: 1, label: "TNF" },
  { id: "sunday_noon", count: 4, rankStart: 2, label: "Sunday noon" },
  { id: "sunday_late", count: 3, rankStart: 6, label: "Sunday late" },
  { id: "snf", count: 1, rankStart: 9, label: "SNF" },
  { id: "mnf", count: 1, rankStart: 10, label: "MNF" },
];

export type ScorecardPick = {
  id: string;
  rank: number;
  slot: string;
  title: string;
  context: string;
  side: "yes" | "no";
  probabilityBps: number;
  executablePriceBps: number;
  edgeBps: number;
  score: number;
  frozenAt: string;
  settledAt: string | null;
  result: "hit" | "miss" | "pending";
  profitOnTen: number | null;
  reconstructed?: boolean;
  recoverySource?: string;
};

export type ScorecardOutageSlot = {
  slot: string;
  count: number;
  status: "legacy_locked" | "not_locked";
  detail: string;
};

export type WeeklyScorecard = {
  key: string;
  label: string;
  season: number | null;
  week: number | null;
  picks: ScorecardPick[];
  settled: number;
  hits: number;
  misses: number;
  profitOnTen: number;
  roi: number;
  expectedPicks?: number;
  outageSlots?: ScorecardOutageSlot[];
  recoveryNote?: string;
};


type RecoveredWeek3Definition =
  | {
      id: string;
      rank: number;
      slot: string;
      playerName: string;
      matchup: string;
      context: string;
      statistic: "rushing_yards" | "receiving_yards" | "receptions";
      direction: "over" | "under";
      threshold: number;
      probabilityBps: number;
      executablePriceBps: number;
      score: number;
      recoveredAt: string;
      recoverySource: string;
    }
  | {
      id: string;
      rank: number;
      slot: string;
      team: string;
      matchup: string;
      context: string;
      statistic: "moneyline";
      direction: "yes";
      threshold: null;
      probabilityBps: number;
      executablePriceBps: number;
      score: number;
      recoveredAt: string;
      recoverySource: string;
    };

// Week 3's original database failed before the Sunday lock windows. These are
// deliberately labeled reconstructed picks: they use pregame model/source
// signals that were publicly available before the games, then grade against
// the recovered nflverse box scores. They never enter model learning.
const RECOVERED_WEEK3_PICKS: RecoveredWeek3Definition[] = [
  {
    id: "recovered-2026-w3-tnf-1",
    rank: 1,
    slot: "TNF",
    playerName: "MarShawn Lloyd",
    matchup: "ATL-GB",
    context: "Falcons at Packers",
    statistic: "rushing_yards",
    direction: "over",
    threshold: 24.5,
    probabilityBps: 6300,
    executablePriceBps: 5122,
    score: 80,
    recoveredAt: "2026-09-25T00:10:00.000Z",
    recoverySource: "RotoWire Week 3 model, A-grade pregame prop",
  },
  {
    id: "recovered-2026-w3-noon-1",
    rank: 2,
    slot: "Sunday noon",
    playerName: "Keon Coleman",
    matchup: "BUF-LAC",
    context: "Chargers at Bills",
    statistic: "receptions",
    direction: "over",
    threshold: 1.5,
    probabilityBps: 6670,
    executablePriceBps: 5050,
    score: 90,
    recoveredAt: "2026-09-27T16:55:00.000Z",
    recoverySource: "Dimers Week 3 pregame prop model",
  },
  {
    id: "recovered-2026-w3-noon-2",
    rank: 3,
    slot: "Sunday noon",
    playerName: "Jalen Coker",
    matchup: "CAR-CLE",
    context: "Panthers at Browns",
    statistic: "receptions",
    direction: "under",
    threshold: 5.5,
    probabilityBps: 6800,
    executablePriceBps: 6350,
    score: 72,
    recoveredAt: "2026-09-27T16:55:00.000Z",
    recoverySource: "Dimers Week 3 pregame prop model",
  },
  {
    id: "recovered-2026-w3-noon-3",
    rank: 4,
    slot: "Sunday noon",
    playerName: "Jameson Williams",
    matchup: "DET-NYJ",
    context: "Jets at Lions",
    statistic: "receptions",
    direction: "under",
    threshold: 4.5,
    probabilityBps: 6720,
    executablePriceBps: 6226,
    score: 72,
    recoveredAt: "2026-09-27T16:55:00.000Z",
    recoverySource: "Dimers Week 3 pregame prop model",
  },
  {
    id: "recovered-2026-w3-noon-4",
    rank: 5,
    slot: "Sunday noon",
    team: "NYG",
    matchup: "NYG-TEN",
    context: "Titans at Giants",
    statistic: "moneyline",
    direction: "yes",
    threshold: null,
    probabilityBps: 6210,
    executablePriceBps: 5500,
    score: 76,
    recoveredAt: "2026-09-27T16:55:00.000Z",
    recoverySource: "Dimers Week 3 pregame best-bet model",
  },
  {
    id: "recovered-2026-w3-late-1",
    rank: 6,
    slot: "Sunday late",
    playerName: "Zay Flowers",
    matchup: "BAL-DAL",
    context: "Ravens at Cowboys",
    statistic: "receptions",
    direction: "under",
    threshold: 5.5,
    probabilityBps: 8400,
    executablePriceBps: 6109,
    score: 97,
    recoveredAt: "2026-09-27T20:00:00.000Z",
    recoverySource: "Dimers Week 3 pregame prop model",
  },
  {
    id: "recovered-2026-w3-late-2",
    rank: 7,
    slot: "Sunday late",
    playerName: "Zay Flowers",
    matchup: "BAL-DAL",
    context: "Ravens at Cowboys",
    statistic: "receiving_yards",
    direction: "under",
    threshold: 71.5,
    probabilityBps: 7520,
    executablePriceBps: 5305,
    score: 95,
    recoveredAt: "2026-09-27T20:00:00.000Z",
    recoverySource: "Dimers Week 3 pregame prop model",
  },
  {
    id: "recovered-2026-w3-late-3",
    rank: 8,
    slot: "Sunday late",
    playerName: "Noah Fant",
    matchup: "LV-NO",
    context: "Raiders at Saints",
    statistic: "receiving_yards",
    direction: "under",
    threshold: 23.5,
    probabilityBps: 7220,
    executablePriceBps: 5283,
    score: 92,
    recoveredAt: "2026-09-27T20:00:00.000Z",
    recoverySource: "Dimers Week 3 pregame prop model",
  },
];

function recoveredNameKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function recoveredProfit(priceBps: number, hit: boolean) {
  return hit ? 10 * (10_000 / priceBps - 1) : -10;
}

async function recoveredWeek3Picks(): Promise<ScorecardPick[]> {
  const db = getDb();
  const playerNames = RECOVERED_WEEK3_PICKS.flatMap((pick) =>
    "playerName" in pick ? [pick.playerName] : [],
  );

  const [statRows, gameRows] = await Promise.all([
    db
      .select({
        playerName: nflPlayers.fullName,
        team: playerGameStats.team,
        opponent: playerGameStats.opponent,
        rushingYards: playerGameStats.rushingYards,
        receivingYards: playerGameStats.receivingYards,
        receptions: playerGameStats.receptions,
        gameStatus: nflGames.status,
        gameUpdatedAt: nflGames.updatedAt,
      })
      .from(playerGameStats)
      .innerJoin(nflPlayers, eq(nflPlayers.id, playerGameStats.playerId))
      .innerJoin(nflGames, eq(nflGames.id, playerGameStats.gameId))
      .where(
        and(
          eq(nflGames.season, 2026),
          eq(nflGames.week, 3),
          eq(nflGames.seasonType, "REG"),
          inArray(nflPlayers.fullName, playerNames),
        ),
      ),
    db
      .select({
        homeTeam: nflGames.homeTeam,
        awayTeam: nflGames.awayTeam,
        homeScore: nflGames.homeScore,
        awayScore: nflGames.awayScore,
        status: nflGames.status,
        updatedAt: nflGames.updatedAt,
      })
      .from(nflGames)
      .where(
        and(
          eq(nflGames.season, 2026),
          eq(nflGames.week, 3),
          eq(nflGames.seasonType, "REG"),
        ),
      ),
  ]);

  return RECOVERED_WEEK3_PICKS.map((definition) => {
    let outcome: boolean | null = null;
    let settledAt: string | null = null;

    if (definition.statistic === "moneyline") {
      const game = gameRows.find(
        (row) =>
          matchupKey(`${row.homeTeam}-${row.awayTeam}`) ===
          matchupKey(definition.matchup),
      );
      if (
        game &&
        /final/i.test(game.status) &&
        game.homeScore !== null &&
        game.awayScore !== null
      ) {
        const winner =
          game.homeScore > game.awayScore
            ? canonicalTeamCode(game.homeTeam)
            : game.awayScore > game.homeScore
              ? canonicalTeamCode(game.awayTeam)
              : null;
        outcome = winner === definition.team;
        settledAt = game.updatedAt.toISOString();
      }
    } else {
      const stat = statRows.find(
        (row) =>
          recoveredNameKey(row.playerName) ===
            recoveredNameKey(definition.playerName) &&
          matchupKey(`${row.team}-${row.opponent}`) ===
            matchupKey(definition.matchup),
      );
      if (stat && /final/i.test(stat.gameStatus)) {
        const value =
          definition.statistic === "rushing_yards"
            ? stat.rushingYards
            : definition.statistic === "receiving_yards"
              ? stat.receivingYards
              : stat.receptions;
        if (value !== null) {
          outcome =
            definition.direction === "over"
              ? value > definition.threshold
              : value < definition.threshold;
          settledAt = stat.gameUpdatedAt.toISOString();
        }
      }
    }

    const subject =
      definition.statistic === "moneyline"
        ? definition.team
        : definition.playerName;
    const family =
      definition.statistic === "moneyline"
        ? "moneyline"
        : definition.statistic;

    return {
      id: definition.id,
      rank: definition.rank,
      slot: definition.slot,
      title: pickTitle({
        family,
        direction: definition.direction,
        threshold: definition.threshold,
        outcomeLabel: subject,
        marketTitle: subject,
        subject,
        side: "yes",
      }),
      context: definition.context,
      side: "yes",
      probabilityBps: definition.probabilityBps,
      executablePriceBps: definition.executablePriceBps,
      edgeBps:
        definition.probabilityBps - definition.executablePriceBps,
      score: definition.score,
      frozenAt: definition.recoveredAt,
      settledAt,
      result:
        outcome === null ? "pending" : outcome ? "hit" : "miss",
      profitOnTen:
        outcome === null
          ? null
          : recoveredProfit(definition.executablePriceBps, outcome),
      reconstructed: true,
      recoverySource: definition.recoverySource,
    };
  });
}

const FAMILY_LABELS: Record<string, string> = {
  passing_yards: "passing yards",
  passing_touchdowns: "passing TDs",
  passing_interceptions: "interceptions",
  rushing_yards: "rushing yards",
  rushing_touchdowns: "rushing TDs",
  receiving_yards: "receiving yards",
  receiving_touchdowns: "receiving TDs",
  receptions: "receptions",
  longest_reception: "longest reception",
  touchdowns: "anytime touchdown",
};

function pickTitle(input: {
  family: string;
  direction: string;
  threshold: number | null;
  outcomeLabel: string;
  marketTitle: string;
  subject: string | null;
  side: "yes" | "no";
}) {
  if (input.family === "moneyline") {
    return input.side === "yes"
      ? `${input.subject ?? input.outcomeLabel} to win`
      : `No on ${input.outcomeLabel}`;
  }
  const direction =
    input.side === "yes"
      ? input.direction
      : input.direction === "over"
        ? "under"
        : input.direction === "under"
          ? "over"
          : input.direction === "yes"
            ? "no"
            : "yes";
  const prefix =
    direction === "over"
      ? "Over"
      : direction === "under"
        ? "Under"
        : direction === "yes"
          ? "Yes"
          : "No";
  const family = FAMILY_LABELS[input.family] ?? input.family.replaceAll("_", " ");
  if (input.subject) {
    return `${input.subject} · ${prefix}${input.threshold === null ? "" : ` ${input.threshold}`} ${family}`;
  }
  return input.side === "yes" ? input.marketTitle : `No · ${input.marketTitle}`;
}

function canonicalTeamCode(code: string) {
  const upper = code.trim().toUpperCase();
  if (upper === "WSH") return "WAS";
  if (upper === "JAC") return "JAX";
  if (upper === "LA") return "LAR";
  return upper;
}

function matchupKey(value: string) {
  return value
    .split("-")
    .map(canonicalTeamCode)
    .filter(Boolean)
    .toSorted()
    .join("-");
}

function publicScore(features: Record<string, number | string | boolean | null>) {
  return typeof features.lynervaScore === "number"
    ? features.lynervaScore
    : null;
}

function easternKickoffParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function scorecardBucketForKickoff(kickoff: Date): ScorecardBucket | null {
  const { weekday, hour } = easternKickoffParts(kickoff);

  if (weekday === "Thu") return "tnf";
  if (weekday === "Mon") return "mnf";

  if (weekday === "Sun") {
    if (hour >= 12 && hour < 15) return "sunday_noon";
    if (hour >= 15 && hour < 19) return "sunday_late";
    if (hour >= 19) return "snf";
  }

  return null;
}

function bucketLabel(bucket: string | null) {
  return BUCKET_RULES.find((rule) => rule.id === bucket)?.label ?? "Pregame";
}

export async function lockEligibleScorecards() {
  const db = getDb();
  const now = new Date();

  const alreadyLocked = await db
    .select({
      season: weeklyScorecardPicks.season,
      week: weeklyScorecardPicks.week,
      bucket: weeklyScorecardPicks.bucket,
    })
    .from(weeklyScorecardPicks);

  const lockedBuckets = new Set(
    alreadyLocked
      .filter((row) => row.bucket)
      .map((row) => `${row.season}:${row.week}:${row.bucket}`),
  );

  const scanFrom = new Date(
    Math.max(
      SCORECARD_BUCKET_LAUNCH_AT.getTime(),
      now.getTime() - LOCK_SCAN_WINDOW_MS,
    ),
  );

  const rows = await db
    .select({
      id: predictions.id,
      normalizedMarketId: predictions.normalizedMarketId,
      predictedProbabilityBps: predictions.predictedProbabilityBps,
      executablePriceBps: predictions.executablePriceBps,
      edgeBps: predictions.edgeBps,
      opportunityScore: predictions.opportunityScore,
      features: predictions.features,
      predictedAt: predictions.predictedAt,
      eventTitle: marketListings.eventTitle,
      marketTitle: marketListings.marketTitle,
      family: normalizedMarkets.family,
      direction: normalizedMarkets.direction,
      threshold: normalizedMarkets.threshold,
      outcomeLabel: normalizedMarkets.outcomeLabel,
    })
    .from(predictions)
    .innerJoin(
      marketListings,
      eq(marketListings.id, predictions.listingId),
    )
    .innerJoin(
      normalizedMarkets,
      eq(normalizedMarkets.id, predictions.normalizedMarketId),
    )
    .where(gte(predictions.predictedAt, scanFrom))
    .orderBy(desc(predictions.predictedAt));

  const grouped = new Map<
    string,
    {
      season: number;
      week: number;
      candidates: typeof rows;
    }
  >();

  for (const row of rows) {
    if (row.features.live === true) continue;
    const season =
      typeof row.features.projectionSeason === "number"
        ? row.features.projectionSeason
        : null;
    const week =
      typeof row.features.projectionWeek === "number"
        ? row.features.projectionWeek
        : null;
    if (!season || !week || publicScore(row.features) === null) continue;

    const key = `${season}:${week}`;
    const group = grouped.get(key) ?? { season, week, candidates: [] };
    group.candidates.push(row);
    grouped.set(key, group);
  }

  for (const { season, week, candidates } of grouped.values()) {
    const games = await db
      .select({
        kickoffAt: nflGames.kickoffAt,
        homeTeam: nflGames.homeTeam,
        awayTeam: nflGames.awayTeam,
      })
      .from(nflGames)
      .where(
        and(
          eq(nflGames.season, season),
          eq(nflGames.week, week),
          eq(nflGames.seasonType, "REG"),
        ),
      );

    if (!games.length) continue;

    const gameByMatchup = new Map(
      games.map((game) => [
        matchupKey(`${game.homeTeam}-${game.awayTeam}`),
        {
          kickoffAt: game.kickoffAt,
          bucket: scorecardBucketForKickoff(game.kickoffAt),
        },
      ]),
    );

    for (const rule of BUCKET_RULES) {
      const lockKey = `${season}:${week}:${rule.id}`;
      if (lockedBuckets.has(lockKey)) continue;

      const bucketGames = games.filter(
        (game) => scorecardBucketForKickoff(game.kickoffAt) === rule.id,
      );
      if (!bucketGames.length) continue;

      const firstKickoffMs = Math.min(
        ...bucketGames.map((game) => game.kickoffAt.getTime()),
      );
      const lockAt = new Date(firstKickoffMs - LOCK_LEAD_MS);

      // The bucket system starts now. It never reconstructs older slates with
      // hindsight. Week 2 therefore keeps only the Monday pick that already
      // existed when this rule was introduced.
      if (lockAt.getTime() < SCORECARD_BUCKET_LAUNCH_AT.getTime()) continue;
      if (now.getTime() < lockAt.getTime()) continue;

      const latestByMarket = new Map<string, (typeof candidates)[number]>();

      for (const candidate of candidates) {
        if (candidate.predictedAt.getTime() > lockAt.getTime()) continue;
        if (
          candidate.predictedAt.getTime() <
          SCORECARD_BUCKET_LAUNCH_AT.getTime()
        ) {
          continue;
        }

        const matchup =
          typeof candidate.features.matchup === "string"
            ? matchupKey(candidate.features.matchup)
            : "";
        const game = gameByMatchup.get(matchup);
        if (!game || game.bucket !== rule.id) continue;
        if (candidate.predictedAt.getTime() >= game.kickoffAt.getTime()) {
          continue;
        }

        if (!latestByMarket.has(candidate.normalizedMarketId)) {
          latestByMarket.set(candidate.normalizedMarketId, candidate);
        }
      }

      const distinct = new Map<string, (typeof candidates)[number]>();
      for (const candidate of [...latestByMarket.values()].toSorted((a, b) => {
        const scoreDiff =
          (publicScore(b.features) ?? -Infinity) -
          (publicScore(a.features) ?? -Infinity);
        return scoreDiff || b.edgeBps - a.edgeBps;
      })) {
        const subject =
          typeof candidate.features.subject === "string"
            ? candidate.features.subject
            : "";
        const matchup =
          typeof candidate.features.matchup === "string"
            ? matchupKey(candidate.features.matchup)
            : candidate.eventTitle;
        const perspective = recommendedPredictionPerspective(candidate);
        const distinctKey = [
          matchup,
          candidate.family,
          subject,
          perspective.side,
        ].join(":");
        if (!distinct.has(distinctKey)) {
          distinct.set(distinctKey, candidate);
        }
      }

      const top = [...distinct.values()].slice(0, rule.count);
      if (top.length < rule.count) continue;

      await db
        .insert(weeklyScorecardPicks)
        .values(
          top.map((candidate, index) => ({
            id: `${season}-week-${week}-${rule.id}-${index + 1}`,
            season,
            week,
            rank: rule.rankStart + index,
            bucket: rule.id,
            bucketRank: index + 1,
            predictionId: candidate.id,
            lockedAt: lockAt,
          })),
        )
        .onConflictDoNothing();

      lockedBuckets.add(lockKey);
    }
  }
}

export async function getWeeklyScorecards(): Promise<WeeklyScorecard[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        rank: weeklyScorecardPicks.rank,
        bucket: weeklyScorecardPicks.bucket,
        bucketRank: weeklyScorecardPicks.bucketRank,
        season: weeklyScorecardPicks.season,
        week: weeklyScorecardPicks.week,
        lockedAt: weeklyScorecardPicks.lockedAt,
        id: predictions.id,
        predictedProbabilityBps: predictions.predictedProbabilityBps,
        executablePriceBps: predictions.executablePriceBps,
        edgeBps: predictions.edgeBps,
        opportunityScore: predictions.opportunityScore,
        features: predictions.features,
        predictedAt: predictions.predictedAt,
        outcome: predictionResults.outcome,
        settledAt: predictionResults.settledAt,
        eventTitle: marketListings.eventTitle,
        marketTitle: marketListings.marketTitle,
        family: normalizedMarkets.family,
        direction: normalizedMarkets.direction,
        threshold: normalizedMarkets.threshold,
        outcomeLabel: normalizedMarkets.outcomeLabel,
      })
      .from(weeklyScorecardPicks)
      .innerJoin(
        predictions,
        eq(predictions.id, weeklyScorecardPicks.predictionId),
      )
      .innerJoin(
        marketListings,
        eq(marketListings.id, predictions.listingId),
      )
      .innerJoin(
        normalizedMarkets,
        eq(normalizedMarkets.id, predictions.normalizedMarketId),
      )
      .leftJoin(
        predictionResults,
        eq(predictionResults.predictionId, predictions.id),
      )
      .orderBy(
        desc(weeklyScorecardPicks.season),
        desc(weeklyScorecardPicks.week),
        asc(weeklyScorecardPicks.rank),
      );

    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.season}-week-${row.week}`;
      const group = grouped.get(key) ?? [];
      group.push(row);
      grouped.set(key, group);
    }

    const cards: WeeklyScorecard[] = [...grouped.entries()]
      .map(([key, picksRows]) => {
        const first = picksRows[0]!;
        const picks: ScorecardPick[] = picksRows.map((row) => {
          const perspective = recommendedPredictionPerspective(row);
          const result =
            row.outcome === null
              ? "pending"
              : row.outcome === 1
                ? "hit"
                : "miss";
          const profitOnTen =
            row.outcome === null
              ? null
              : row.outcome === 1
                ? row.executablePriceBps > 0
                  ? 10 * (10_000 / row.executablePriceBps - 1)
                  : null
                : -10;
          const subject =
            typeof row.features.subject === "string"
              ? row.features.subject
              : null;

          return {
            id: row.id,
            rank: row.rank,
            slot: bucketLabel(row.bucket),
            title: pickTitle({
              family: row.family,
              direction: row.direction,
              threshold: row.threshold,
              outcomeLabel: row.outcomeLabel,
              marketTitle: row.marketTitle,
              subject,
              side: perspective.side,
            }),
            context: row.eventTitle,
            side: perspective.side,
            probabilityBps: perspective.probabilityBps,
            executablePriceBps: row.executablePriceBps,
            edgeBps: row.edgeBps,
            score: publicScore(row.features) ?? row.opportunityScore,
            frozenAt: row.lockedAt.toISOString(),
            settledAt: row.settledAt?.toISOString() ?? null,
            result,
            profitOnTen,
          };
        });

        const settledPicks = picks.filter((pick) => pick.profitOnTen !== null);
        const profitOnTen = settledPicks.reduce(
          (sum, pick) => sum + (pick.profitOnTen ?? 0),
          0,
        );
        const settled = settledPicks.length;
        const hits = picks.filter((pick) => pick.result === "hit").length;

        return {
          key,
          label: `NFL Week ${first.week}`,
          season: first.season,
          week: first.week,
          picks,
          settled,
          hits,
          misses: picks.filter((pick) => pick.result === "miss").length,
          profitOnTen,
          roi: settled ? profitOnTen / (settled * 10) : 0,
        };
      });

    const week3Key = "2026-week-3";
    const recovered = await recoveredWeek3Picks();
    const existingWeek3 = cards.find((card) => card.key === week3Key);
    if (existingWeek3) {
      const realRanks = new Set(existingWeek3.picks.map((pick) => pick.rank));
      existingWeek3.picks = [
        ...existingWeek3.picks,
        ...recovered.filter((pick) => !realRanks.has(pick.rank)),
      ].toSorted((first, second) => first.rank - second.rank);
      const settledPicks = existingWeek3.picks.filter(
        (pick) => pick.profitOnTen !== null,
      );
      existingWeek3.settled = settledPicks.length;
      existingWeek3.hits = existingWeek3.picks.filter(
        (pick) => pick.result === "hit",
      ).length;
      existingWeek3.misses = existingWeek3.picks.filter(
        (pick) => pick.result === "miss",
      ).length;
      existingWeek3.profitOnTen = settledPicks.reduce(
        (sum, pick) => sum + (pick.profitOnTen ?? 0),
        0,
      );
      existingWeek3.roi = existingWeek3.settled
        ? existingWeek3.profitOnTen / (existingWeek3.settled * 10)
        : 0;
      existingWeek3.expectedPicks = 10;
      existingWeek3.outageSlots = undefined;
      existingWeek3.recoveryNote =
        "Ranks 1-8 were reconstructed from pregame Week 3 model/source signals after the database outage. Any genuine locked row takes precedence automatically. Reconstructed rows are audit-only and never enter model learning.";
    } else {
      const settledPicks = recovered.filter((pick) => pick.profitOnTen !== null);
      const profitOnTen = settledPicks.reduce(
        (sum, pick) => sum + (pick.profitOnTen ?? 0),
        0,
      );
      cards.push({
        key: week3Key,
        label: "NFL Week 3",
        season: 2026,
        week: 3,
        picks: recovered,
        settled: settledPicks.length,
        hits: recovered.filter((pick) => pick.result === "hit").length,
        misses: recovered.filter((pick) => pick.result === "miss").length,
        profitOnTen,
        roi: settledPicks.length
          ? profitOnTen / (settledPicks.length * 10)
          : 0,
        expectedPicks: 10,
        recoveryNote:
          "Ranks 1-8 were reconstructed from pregame Week 3 model/source signals after the database outage. Reconstructed rows are audit-only and never enter model learning.",
      });
    }

    return cards
      .toSorted(
        (first, second) =>
          (second.season ?? 0) - (first.season ?? 0) ||
          (second.week ?? 0) - (first.week ?? 0),
      )
      .slice(0, 12);
  } catch (error) {
    console.error("Weekly scorecards unavailable", error);
    return [];
  }
}

export async function refreshWeeklyScorecards() {
  // Keep network settlement work out of the user's page-load path. The
  // long-running scheduler is authoritative; page visits also enqueue this
  // bounded self-heal after the response has already been sent.
  await lockEligibleScorecards();
  await settleLockedScorecardPredictions();
}
