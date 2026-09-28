import "server-only";

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

const MB = 1024 * 1024;
const CLEANUP_THRESHOLD_BYTES = 300 * MB;
const EMERGENCY_THRESHOLD_BYTES = 430 * MB;
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60_000;

let lastMaintenanceAt = 0;

function localDatabasePath() {
  const url =
    process.env.HUDDLEMARK_DATABASE_URL ??
    process.env.TURSO_DATABASE_URL;
  if (!url?.startsWith("file:")) return null;
  const raw = url.slice("file:".length);
  if (!raw) return null;
  return raw.startsWith("/") ? raw : resolve(raw);
}

async function fileSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function getLocalDatabaseStorageState() {
  const path = localDatabasePath();
  if (!path) {
    return {
      local: false,
      path: null,
      databaseBytes: 0,
      walBytes: 0,
      totalBytes: 0,
      emergency: false,
    };
  }

  const [databaseBytes, walBytes] = await Promise.all([
    fileSize(path),
    fileSize(`${path}-wal`),
  ]);
  const totalBytes = databaseBytes + walBytes;
  return {
    local: true,
    path,
    databaseBytes,
    walBytes,
    totalBytes,
    emergency: totalBytes >= EMERGENCY_THRESHOLD_BYTES,
  };
}

export async function allowBulkDatabaseWrites() {
  const state = await getLocalDatabaseStorageState();
  return !state.local || !state.emergency;
}

export async function runStorageMaintenance(options?: { force?: boolean }) {
  const before = await getLocalDatabaseStorageState();
  if (!before.local) return { ran: false, before, after: before };

  const now = Date.now();
  const due =
    options?.force ||
    before.totalBytes >= CLEANUP_THRESHOLD_BYTES ||
    now - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS;
  if (!due) return { ran: false, before, after: before };

  const db = getDb();

  // This table is intentionally unused now. Keeping it empty prevents an old
  // deployment or recovery import from turning SQLite into a tick database.
  await db.run(sql.raw("DELETE FROM market_price_snapshots"));

  // Calibration only consumes the latest 1,500 settled predictions. Keep a
  // 2,000-row cushion plus every permanent scorecard prediction.
  await db.run(sql.raw(`
    DELETE FROM prediction_results
    WHERE prediction_id NOT IN (
      SELECT prediction_id FROM weekly_scorecard_picks
    )
    AND prediction_id NOT IN (
      SELECT prediction_id
      FROM prediction_results
      ORDER BY settled_at DESC
      LIMIT 2000
    )
  `));

  // Current-state predictions for games that ended days ago are disposable
  // after their calibration result has rolled out of the bounded window.
  await db.run(sql.raw(`
    DELETE FROM predictions
    WHERE id NOT IN (
      SELECT prediction_id FROM weekly_scorecard_picks
    )
    AND id NOT IN (
      SELECT prediction_id FROM prediction_results
    )
    AND listing_id IN (
      SELECT id
      FROM market_listings
      WHERE closes_at IS NOT NULL
        AND closes_at < unixepoch('now', '-2 days')
    )
  `));

  await db.run(sql.raw(`
    DELETE FROM market_listings
    WHERE closes_at IS NOT NULL
      AND closes_at < unixepoch('now', '-14 days')
      AND id NOT IN (SELECT listing_id FROM predictions)
  `));

  await db.run(sql.raw(`
    DELETE FROM normalized_markets
    WHERE settlement_at IS NOT NULL
      AND settlement_at < unixepoch('now', '-14 days')
      AND id NOT IN (SELECT normalized_market_id FROM predictions)
      AND id NOT IN (
        SELECT normalized_market_id
        FROM market_listings
        WHERE normalized_market_id IS NOT NULL
      )
  `));

  await db.run(sql.raw(`
    DELETE FROM market_events
    WHERE starts_at IS NOT NULL
      AND starts_at < unixepoch('now', '-21 days')
      AND id NOT IN (SELECT event_id FROM normalized_markets)
  `));

  await db.run(sql.raw(`
    DELETE FROM weather_snapshots
    WHERE captured_at < unixepoch('now', '-30 days')
  `));

  await db.run(sql.raw(`
    DELETE FROM "verification"
    WHERE expires_at < unixepoch()
  `));

  await db.run(sql.raw(`
    DELETE FROM "session"
    WHERE expires_at < unixepoch()
  `));

  await db.run(sql.raw("PRAGMA optimize"));
  await db.run(sql.raw("PRAGMA incremental_vacuum(5000)"));
  await db.run(sql.raw("PRAGMA wal_checkpoint(TRUNCATE)"));

  lastMaintenanceAt = now;
  const after = await getLocalDatabaseStorageState();
  console.info(
    "[database-storage]",
    JSON.stringify({
      beforeMb: Math.round(before.totalBytes / MB),
      afterMb: Math.round(after.totalBytes / MB),
      emergency: after.emergency,
    }),
  );
  return { ran: true, before, after };
}
