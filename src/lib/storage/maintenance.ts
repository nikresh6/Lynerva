import "server-only";

import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { activeDatabaseUrl, getDb } from "@/db";

const SOFT_LIMIT_BYTES = 300 * 1024 * 1024;
const EMERGENCY_LIMIT_BYTES = 420 * 1024 * 1024;

function localDatabasePath() {
  const url = activeDatabaseUrl();
  if (!url.startsWith("file:")) return null;
  try {
    return fileURLToPath(new URL(url));
  } catch {
    return url.slice("file:".length);
  }
}

async function fileSize(path: string) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function localDatabaseFootprintBytes() {
  const path = localDatabasePath();
  if (!path) return null;
  const [db, wal, shm] = await Promise.all([
    fileSize(path),
    fileSize(`${path}-wal`),
    fileSize(`${path}-shm`),
  ]);
  return db + wal + shm;
}

async function compactDisposableRows(aggressive: boolean) {
  const db = getDb();

  // Legacy tick snapshots are not used by the application anymore.
  await db.run(sql.raw("DELETE FROM market_price_snapshots"));

  // Keep settled calibration evidence bounded. Locked scorecard predictions
  // are permanent, while non-scorecard calibration examples are a rolling
  // sample rather than an unbounded event log.
  if (aggressive) {
    await db.run(sql.raw(`
      DELETE FROM prediction_results
      WHERE prediction_id NOT IN (
        SELECT prediction_id FROM weekly_scorecard_picks
      )
      AND prediction_id NOT IN (
        SELECT prediction_id
        FROM prediction_results
        ORDER BY settled_at DESC
        LIMIT 1200
      )
    `));
  } else {
    await db.run(sql.raw(`
      DELETE FROM prediction_results
      WHERE prediction_id NOT IN (
        SELECT prediction_id FROM weekly_scorecard_picks
      )
      AND prediction_id NOT IN (
        SELECT prediction_id
        FROM prediction_results
        ORDER BY settled_at DESC
        LIMIT 2500
      )
    `));
  }

  const ageSeconds = aggressive ? 6 * 60 * 60 : 36 * 60 * 60;
  await db.run(sql.raw(`
    DELETE FROM predictions
    WHERE predicted_at < unixepoch() - ${ageSeconds}
      AND id NOT IN (
        SELECT prediction_id FROM weekly_scorecard_picks
      )
      AND id NOT IN (
        SELECT prediction_id FROM prediction_results
      )
  `));

  const listingAgeSeconds = aggressive ? 7 * 24 * 60 * 60 : 21 * 24 * 60 * 60;
  await db.run(sql.raw(`
    DELETE FROM market_listings
    WHERE status IN ('closed', 'settled')
      AND fetched_at < unixepoch() - ${listingAgeSeconds}
      AND id NOT IN (
        SELECT listing_id FROM predictions
      )
  `));

  // Expired auth helpers should never accumulate forever.
  await db.run(sql.raw(
    "DELETE FROM verification WHERE expires_at < unixepoch()",
  ));
  await db.run(sql.raw(
    "DELETE FROM session WHERE expires_at < unixepoch()",
  ));

  // Reclaim WAL growth without requiring a full VACUUM, which can temporarily
  // need a second copy of the database and is unsafe near a small disk limit.
  await db.run(sql.raw("PRAGMA wal_checkpoint(TRUNCATE)"));
  await db.run(sql.raw("PRAGMA optimize"));
}

export async function runStorageMaintenance() {
  const before = await localDatabaseFootprintBytes();
  if (before === null) {
    return {
      local: false,
      beforeBytes: null,
      afterBytes: null,
      aggressive: false,
      emergency: false,
    };
  }

  const aggressive = before >= SOFT_LIMIT_BYTES;
  await compactDisposableRows(aggressive);
  const after = await localDatabaseFootprintBytes();

  const result = {
    local: true,
    beforeBytes: before,
    afterBytes: after,
    aggressive,
    emergency: after !== null && after >= EMERGENCY_LIMIT_BYTES,
  };

  console.info("[storage-maintenance]", JSON.stringify(result));
  return result;
}

export async function marketPersistenceAllowed() {
  const size = await localDatabaseFootprintBytes();
  if (size === null) return true;
  if (size < EMERGENCY_LIMIT_BYTES) return true;

  const result = await runStorageMaintenance();
  return !result.emergency;
}
