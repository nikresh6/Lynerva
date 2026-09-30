import "server-only";

import { getFreshMarketOpportunities } from "@/lib/markets/service";
import { persistMarkets } from "@/lib/markets/persist";
import { ingestNflverseSeason } from "@/lib/nfl/nflverse";
import { getLiveNflGames } from "@/lib/nfl/live";
import { getEspnPlayerGameStats } from "@/lib/nfl/live-player-stats";
import {
  invalidatePersistedPlayerHistoryCache,
  recordEspnFinalPlayerStats,
} from "@/lib/nfl/history";
import {
  restoreLegacySourceWeightHistory,
  runSourceLearningFromActuals,
  runSourceLearningLoop,
  type SourceLearningActualRow,
} from "@/lib/model/source-learning";
import { runMoneylineSourceLearning } from "@/lib/model/moneyline-learning";
import { settleKalshiPredictions } from "@/lib/model/results";
import { lockEligibleScorecards } from "@/lib/model/scorecard";
import {
  hasWeekRecoveryMarker,
  recoverHistoricalSourceWeeks,
  recoverOutageWeek,
} from "@/lib/recovery/week";
import {
  marketPersistenceAllowed,
  runStorageMaintenance,
} from "@/lib/storage/maintenance";

const MARKET_INITIAL_DELAY_MS = 15_000;
const MARKET_TICK_MS = 5 * 60_000;
const MARKET_NORMAL_INTERVAL_MS = 30 * 60_000;
const MARKET_HIGH_FREQUENCY_WINDOW_MS = 45 * 60_000;
const NFLVERSE_INITIAL_DELAY_MS = 2 * 60_000;
const NFLVERSE_INTERVAL_MS = 12 * 60 * 60_000;
const FINAL_GRADING_INITIAL_DELAY_MS = 60_000;
const FINAL_GRADING_INTERVAL_MS = 30 * 60_000;
const SCORECARD_LOCK_INITIAL_DELAY_MS = 30_000;
const SCORECARD_LOCK_INTERVAL_MS = 60_000;
const STORAGE_MAINTENANCE_INITIAL_DELAY_MS = 3 * 60_000;
const STORAGE_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60_000;
const OUTAGE_RECOVERY_INITIAL_DELAY_MS = 20_000;
const LEGACY_WEIGHT_RESTORE_DELAY_MS = 5_000;
const HISTORICAL_SOURCE_RECOVERY_INITIAL_DELAY_MS = 30_000;
const HISTORICAL_SOURCE_RECOVERY_INTERVAL_MS = 30 * 60_000;
const BACKGROUND_RSS_GUARD_MB = 760;
const BACKGROUND_HEAP_GUARD_MB = 560;

type SchedulerGlobal = typeof globalThis & {
  __lynervaRailwaySchedulerStarted?: boolean;
};

let marketJobRunning = false;
let nflverseJobRunning = false;
let finalGradingJobRunning = false;
let scorecardLockJobRunning = false;
let databaseBlockedUntil = 0;
let lastFinalLearningFingerprint: string | null = null;
let lastMarketPersistenceAt = 0;
let storageMaintenanceRunning = false;
let outageRecoveryRunning = false;
let historicalSourceRecoveryComplete = false;

function errorChainText(error: unknown) {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      messages.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  return messages.join(" ");
}

function noteDatabaseBlock(error: unknown) {
  const text = errorChainText(error);
  if (!/BLOCKED|reads are blocked|writes are blocked/i.test(text)) {
    return false;
  }
  databaseBlockedUntil = Date.now() + 60 * 60_000;
  console.error(
    `[lynerva-background] database quota block detected, pausing DB jobs until ${new Date(databaseBlockedUntil).toISOString()}`,
  );
  return true;
}

function databaseBackoffActive() {
  return Date.now() < databaseBlockedUntil;
}

function backgroundMemoryPressure() {
  const memory = process.memoryUsage();
  const rssMb = memory.rss / 1024 / 1024;
  const heapUsedMb = memory.heapUsed / 1024 / 1024;
  return {
    high:
      rssMb >= BACKGROUND_RSS_GUARD_MB ||
      heapUsedMb >= BACKGROUND_HEAP_GUARD_MB,
    rssMb: Math.round(rssMb),
    heapUsedMb: Math.round(heapUsedMb),
  };
}

async function marketPersistenceDue() {
  const now = Date.now();
  if (now - lastMarketPersistenceAt >= MARKET_NORMAL_INTERVAL_MS) return true;

  try {
    const games = await getLiveNflGames();
    return games.some((game) => {
      const kickoff = new Date(game.startsAt).getTime();
      const untilKickoff = kickoff - now;
      return (
        untilKickoff > 0 &&
        untilKickoff <= MARKET_HIGH_FREQUENCY_WINDOW_MS
      );
    });
  } catch {
    // A schedule lookup failure should not turn into a high-frequency retry
    // loop. The normal 30-minute cadence will try again.
    return false;
  }
}

async function maintainStorage() {
  if (storageMaintenanceRunning || databaseBackoffActive()) return;
  storageMaintenanceRunning = true;
  try {
    const result = await runStorageMaintenance();
    logJob("storage-maintenance", "completed", result);
  } catch (error) {
    noteDatabaseBlock(error);
    logJob("storage-maintenance", "failed", error);
  } finally {
    storageMaintenanceRunning = false;
  }
}

function requestedOutageRecovery() {
  const value = process.env.RECOVER_WEEK_ON_START?.trim();
  if (!value) return null;
  const match = /^(\d{4}):(\d{1,2})$/.exec(value);
  if (!match) {
    console.error(
      "[lynerva-background] ignoring invalid RECOVER_WEEK_ON_START, expected YYYY:W",
    );
    return null;
  }
  return { season: Number(match[1]), week: Number(match[2]) };
}

async function runRequestedOutageRecovery() {
  if (outageRecoveryRunning || databaseBackoffActive()) return;
  const request = requestedOutageRecovery();
  if (!request) return;
  if (await hasWeekRecoveryMarker(request.season, request.week)) {
    logJob("outage-recovery", "completed", {
      season: request.season,
      week: request.week,
      skipped: "already-recovered",
    });
    return;
  }

  outageRecoveryRunning = true;
  nflverseJobRunning = true;
  try {
    logJob("outage-recovery", "started", request);
    const result = await recoverOutageWeek(request.season, request.week);
    logJob("outage-recovery", "completed", result);
  } catch (error) {
    noteDatabaseBlock(error);
    logJob("outage-recovery", "failed", error);
  } finally {
    nflverseJobRunning = false;
    outageRecoveryRunning = false;
  }
}

async function restoreLegacyLearningState() {
  if (databaseBackoffActive()) return;
  try {
    const result = await restoreLegacySourceWeightHistory();
    const grading = await runSourceLearningLoop(2026);
    logJob("legacy-source-weights", "completed", { ...result, grading });
  } catch (error) {
    noteDatabaseBlock(error);
    logJob("legacy-source-weights", "failed", error);
  }
}

async function recoverHistoricalSourceHistory() {
  if (
    historicalSourceRecoveryComplete ||
    outageRecoveryRunning ||
    nflverseJobRunning ||
    databaseBackoffActive()
  ) {
    return;
  }

  const [week1Done, week2Done] = await Promise.all([
    hasWeekRecoveryMarker(2026, 1),
    hasWeekRecoveryMarker(2026, 2),
  ]);
  if (week1Done && week2Done) {
    historicalSourceRecoveryComplete = true;
    logJob("historical-source-recovery", "completed", {
      skipped: "already-recovered",
      weeks: [1, 2],
    });
    return;
  }

  nflverseJobRunning = true;
  try {
    logJob("historical-source-recovery", "started", { season: 2026, weeks: [1, 2] });
    const result = await recoverHistoricalSourceWeeks(2026, [1, 2]);
    historicalSourceRecoveryComplete = true;
    logJob("historical-source-recovery", "completed", result);
  } catch (error) {
    noteDatabaseBlock(error);
    logJob("historical-source-recovery", "failed", error);
  } finally {
    nflverseJobRunning = false;
  }
}

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
  if (marketJobRunning || databaseBackoffActive()) return;
  if (!(await marketPersistenceDue())) return;

  const memory = backgroundMemoryPressure();
  if (memory.high) {
    logJob("markets", "completed", {
      skipped: "memory-pressure",
      rssMb: memory.rssMb,
      heapUsedMb: memory.heapUsedMb,
    });
    return;
  }

  if (!(await marketPersistenceAllowed())) {
    logJob("markets", "completed", {
      skipped: "storage-emergency",
    });
    return;
  }

  marketJobRunning = true;
  logJob("markets", "started");

  try {
    const payload = await getFreshMarketOpportunities();
    const stored = await persistMarkets(payload);
    await lockEligibleScorecards();
    lastMarketPersistenceAt = Date.now();
    logJob("markets", "completed", {
      sourceProjectionsStored: stored.sourceProjectionsStored,
      listingsStored: stored.listingsStored,
      predictionsStored: stored.predictionsStored,
      snapshotsStored: stored.snapshotsStored,
    });
  } catch (error) {
    noteDatabaseBlock(error);
    logJob("markets", "failed", error);
  } finally {
    marketJobRunning = false;
  }
}

async function lockScorecardsIndependently() {
  if (scorecardLockJobRunning || databaseBackoffActive()) return;
  scorecardLockJobRunning = true;
  try {
    // This is intentionally independent from market persistence. A slow or
    // failed market refresh must never prevent the scorecard from freezing the
    // latest prediction that existed before the cutoff.
    await lockEligibleScorecards();
  } catch (error) {
    noteDatabaseBlock(error);
    logJob("scorecard-lock", "failed", error);
  } finally {
    scorecardLockJobRunning = false;
  }
}

async function refreshNflverseAndLearning() {
  if (nflverseJobRunning || databaseBackoffActive()) return;
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
      playerHistoryCoverage: result.playerHistoryCoverage,
      learning: result.learning,
      moneylineLearning,
    });
  } catch (error) {
    noteDatabaseBlock(error);
    logJob("nflverse", "failed", error);
  } finally {
    nflverseJobRunning = false;
  }
}

async function gradeFinalEspnGames() {
  if (finalGradingJobRunning || databaseBackoffActive()) return;
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

    const finalFingerprint = finals
      .map((game) => game.id)
      .toSorted()
      .join("|");
    const shouldRunLearning =
      finalFingerprint !== lastFinalLearningFingerprint;

    const completed = shouldRunLearning
      ? await Promise.all(
          finals.map(async (game) => ({
            game,
            rows: await getEspnPlayerGameStats(game.id),
          })),
        )
      : [];

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
    let learningFailed = false;
    const effectiveWeeks = new Set<number>();
    for (const [season, actuals] of bySeason) {
      const result = await runSourceLearningFromActuals(season, actuals);
      graded += result.graded;
      weightsStored += result.weightsStored;
      if ("error" in result && result.error) learningFailed = true;
      if (result.effectiveWeek !== null) {
        effectiveWeeks.add(result.effectiveWeek);
      }
      const moneylineResult = await runMoneylineSourceLearning(season);
      if ("error" in moneylineResult && moneylineResult.error) {
        learningFailed = true;
      }
    }

    const predictionSettlement = await settleKalshiPredictions();
    if (shouldRunLearning && !learningFailed) {
      lastFinalLearningFingerprint = finalFingerprint;
    }

    logJob("espn-final-grading", "completed", {
      finalGamesChecked: finals.length,
      graded,
      weightsStored,
      effectiveWeeks: [...effectiveWeeks],
      predictionSettlement,
    });
  } catch (error) {
    noteDatabaseBlock(error);
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
    "[lynerva-background] Railway scheduler active: market persistence every 30m normally and every 5m near kickoff, independent scorecard lock checks every 1m, ESPN final grading every 30m, nflverse backfill every 12h, storage maintenance every 6h.",
  );

  // The scheduler wakes every five minutes but full market persistence runs
  // every thirty minutes except in the forty-five minutes before kickoff.
  // That preserves fresh five-minute scorecard locks without modeling and
  // writing the entire board around the clock. Final ESPN box scores grade
  // completed games quickly, while nflverse is a slower durability backfill.
  const recoveryRequest = requestedOutageRecovery();
  if (recoveryRequest) {
    setTimeout(() => {
      void runRequestedOutageRecovery();
    }, OUTAGE_RECOVERY_INITIAL_DELAY_MS);
  }

  setTimeout(() => {
    void restoreLegacyLearningState();
  }, LEGACY_WEIGHT_RESTORE_DELAY_MS).unref();

  recurringJob(
    recoverHistoricalSourceHistory,
    HISTORICAL_SOURCE_RECOVERY_INITIAL_DELAY_MS,
    HISTORICAL_SOURCE_RECOVERY_INTERVAL_MS,
  );

  recurringJob(
    persistCurrentMarkets,
    MARKET_INITIAL_DELAY_MS,
    MARKET_TICK_MS,
  );
  recurringJob(
    lockScorecardsIndependently,
    SCORECARD_LOCK_INITIAL_DELAY_MS,
    SCORECARD_LOCK_INTERVAL_MS,
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
  recurringJob(
    maintainStorage,
    STORAGE_MAINTENANCE_INITIAL_DELAY_MS,
    STORAGE_MAINTENANCE_INTERVAL_MS,
  );
}
