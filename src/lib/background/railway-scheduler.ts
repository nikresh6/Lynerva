import "server-only";

import { getMarketOpportunities } from "@/lib/markets/service";
import { persistMarkets } from "@/lib/markets/persist";
import { ingestNflverseSeason } from "@/lib/nfl/nflverse";
import { getLiveNflGames } from "@/lib/nfl/live";
import { getEspnPlayerGameStats } from "@/lib/nfl/live-player-stats";
import {
  invalidatePersistedPlayerHistoryCache,
  recordEspnFinalPlayerStats,
} from "@/lib/nfl/history";
import {
  runSourceLearningFromActuals,
  type SourceLearningActualRow,
} from "@/lib/model/source-learning";
import { runMoneylineSourceLearning } from "@/lib/model/moneyline-learning";
import { settleKalshiPredictions } from "@/lib/model/results";
import { lockEligibleScorecards } from "@/lib/model/scorecard";

const MARKET_INITIAL_DELAY_MS = 15_000;
const MARKET_INTERVAL_MS = 5 * 60_000;
const NFLVERSE_INITIAL_DELAY_MS = 30_000;
const NFLVERSE_INTERVAL_MS = 2 * 60 * 60_000;
const FINAL_GRADING_INITIAL_DELAY_MS = 60_000;
const FINAL_GRADING_INTERVAL_MS = 30 * 60_000;

type SchedulerGlobal = typeof globalThis & {
  __lynervaRailwaySchedulerStarted?: boolean;
};

let marketJobRunning = false;
let nflverseJobRunning = false;
let finalGradingJobRunning = false;

function logJob(
  job: string,
  status: "started" | "completed" | "failed",
  detail?: unknown,
) {
  const suffix =
    detail === undefined
      ? ""
      : ` ${detail instanceof Error ? detail.message : JSON.stringify(detail)}`;
  console.info(
    `[lynerva-background] ${new Date().toISOString()} ${job} ${status}${suffix}`,
  );
}

async function persistCurrentMarkets() {
  if (marketJobRunning) return;
  marketJobRunning = true;
  logJob("markets", "started");

  try {
    const payload = await getMarketOpportunities();
    const stored = await persistMarkets(payload);
    await lockEligibleScorecards();
    logJob("markets", "completed", {
      sourceProjectionsStored: stored.sourceProjectionsStored,
      listingsStored: stored.listingsStored,
      snapshotsStored: stored.snapshotsStored,
    });
  } catch (error) {
    logJob("markets", "failed", error);
  } finally {
    marketJobRunning = false;
  }
}

async function refreshNflverseAndLearning() {
  if (nflverseJobRunning) return;
  nflverseJobRunning = true;
  logJob("nflverse", "started");

  try {
    const season = new Date().getUTCFullYear();
    const result = await ingestNflverseSeason(season);
    invalidatePersistedPlayerHistoryCache();
    const moneylineLearning = await runMoneylineSourceLearning(season);
    logJob("nflverse", "completed", {
      season,
      gamesStored: result.gamesStored,
      statsStored: result.statsStored,
      learning: result.learning,
      moneylineLearning,
    });
  } catch (error) {
    logJob("nflverse", "failed", error);
  } finally {
    nflverseJobRunning = false;
  }
}

async function gradeFinalEspnGames() {
  if (finalGradingJobRunning) return;
  finalGradingJobRunning = true;
  logJob("espn-final-grading", "started");

  try {
    const games = await getLiveNflGames();
    const finals = games.filter(
      (game) =>
        game.seasonType === 2 &&
        game.seasonYear !== null &&
        game.week !== null &&
        (game.state === "post" || /final/i.test(game.status)),
    );

    const completed = await Promise.all(
      finals.map(async (game) => ({
        game,
        rows: await getEspnPlayerGameStats(game.id),
      })),
    );

    const bySeason = new Map<number, SourceLearningActualRow[]>();
    for (const { game, rows } of completed) {
      const season = game.seasonYear;
      const week = game.week;
      if (season === null || week === null) continue;

      // Feed completed ESPN box scores into the current-season history cache
      // immediately. The player variance model can then learn after every game
      // instead of waiting for the slower nflverse durability backfill.
      recordEspnFinalPlayerStats(season, week, rows);

      const actuals = bySeason.get(season) ?? [];
      actuals.push(
        ...rows.map((row) => ({
          week,
          playerName: row.playerName,
          passingYards: row.passingYards,
          passingTouchdowns: row.passingTouchdowns,
          passingInterceptions: row.passingInterceptions,
          rushingYards: row.rushingYards,
          rushingTouchdowns: row.rushingTouchdowns,
          receivingYards: row.receivingYards,
          receptions: row.receptions,
          receivingTouchdowns: row.receivingTouchdowns,
        })),
      );
      bySeason.set(season, actuals);
    }

    let graded = 0;
    let weightsStored = 0;
    const effectiveWeeks = new Set<number>();
    for (const [season, actuals] of bySeason) {
      const result = await runSourceLearningFromActuals(season, actuals);
      graded += result.graded;
      weightsStored += result.weightsStored;
      if (result.effectiveWeek !== null) {
        effectiveWeeks.add(result.effectiveWeek);
      }
      await runMoneylineSourceLearning(season);
    }

    const predictionSettlement = await settleKalshiPredictions();

    logJob("espn-final-grading", "completed", {
      finalGamesChecked: finals.length,
      graded,
      weightsStored,
      effectiveWeeks: [...effectiveWeeks],
      predictionSettlement,
    });
  } catch (error) {
    logJob("espn-final-grading", "failed", error);
  } finally {
    finalGradingJobRunning = false;
  }
}

function recurringJob(
  task: () => Promise<void>,
  initialDelayMs: number,
  intervalMs: number,
) {
  const timeout = setTimeout(() => {
    void task();
    const interval = setInterval(() => void task(), intervalMs);
    interval.unref();
  }, initialDelayMs);
  timeout.unref();
}

export function startRailwayBackgroundJobs() {
  const globalState = globalThis as SchedulerGlobal;
  if (globalState.__lynervaRailwaySchedulerStarted) return;
  globalState.__lynervaRailwaySchedulerStarted = true;

  console.info(
    "[lynerva-background] Railway scheduler active: markets and scorecard locks every 5m, ESPN final grading every 30m, nflverse backfill every 2h.",
  );

  // Market persistence runs every five minutes so each scorecard slate can
  // freeze against the latest snapshot at its five-minute pre-kickoff cutoff.
  // Source projections themselves remain first-capture immutable for learning.
  // Final ESPN box scores grade completed games quickly,
  // while nflverse remains the durable historical backfill. Learned weights
  // remain effective for the following week, so partial Sunday results never
  // leak into later games from the same NFL week.
  recurringJob(
    persistCurrentMarkets,
    MARKET_INITIAL_DELAY_MS,
    MARKET_INTERVAL_MS,
  );
  recurringJob(
    gradeFinalEspnGames,
    FINAL_GRADING_INITIAL_DELAY_MS,
    FINAL_GRADING_INTERVAL_MS,
  );
  recurringJob(
    refreshNflverseAndLearning,
    NFLVERSE_INITIAL_DELAY_MS,
    NFLVERSE_INTERVAL_MS,
  );
}
