import "server-only";

import { getMarketOpportunities } from "@/lib/markets/service";
import { persistMarkets } from "@/lib/markets/persist";
import { ingestNflverseSeason } from "@/lib/nfl/nflverse";

const MARKET_INITIAL_DELAY_MS = 15_000;
const MARKET_INTERVAL_MS = 20 * 60_000;
const NFLVERSE_INITIAL_DELAY_MS = 90_000;
const NFLVERSE_INTERVAL_MS = 12 * 60 * 60_000;

type SchedulerGlobal = typeof globalThis & {
  __lynervaRailwaySchedulerStarted?: boolean;
};

let marketJobRunning = false;
let nflverseJobRunning = false;

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
    logJob("nflverse", "completed", {
      season,
      gamesStored: result.gamesStored,
      statsStored: result.statsStored,
      learning: result.learning,
    });
  } catch (error) {
    logJob("nflverse", "failed", error);
  } finally {
    nflverseJobRunning = false;
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
    "[lynerva-background] Railway scheduler active: markets every 20m, nflverse/source grading every 12h.",
  );

  // Market persistence captures the latest pregame source projections used by
  // the learning loop. nflverse later supplies settled ground truth and
  // recomputes source weights. Both jobs run in the long-lived Railway Node
  // process, so Vercel cron configuration is not required on Railway.
  recurringJob(
    persistCurrentMarkets,
    MARKET_INITIAL_DELAY_MS,
    MARKET_INTERVAL_MS,
  );
  recurringJob(
    refreshNflverseAndLearning,
    NFLVERSE_INITIAL_DELAY_MS,
    NFLVERSE_INTERVAL_MS,
  );
}
