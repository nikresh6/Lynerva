// Startup-only, read-only verification of a remotely configured libSQL database.
// Emits table names and aggregate counts only. Never prints credentials or row data.
import { createClient } from "@libsql/client";

const url = process.env.HUDDLEMARK_DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
if (!url) {
  console.warn("[database-inspect] no URL configured");
} else {
  let client;
  try {
    client = createClient({
      url,
      ...(url.startsWith("file:") ? {} : { authToken: process.env.TURSO_AUTH_TOKEN }),
    });
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tableNames = tables.rows.map((r) => String(r.name));
    const sample = {};
    for (const name of [
      "user", "user_positions", "predictions", "prediction_results",
      "weekly_scorecard_picks", "source_weight_history", "player_game_stats"
    ]) {
      if (!tableNames.includes(name)) {
        sample[name] = "missing";
        continue;
      }
      const result = await client.execute(`SELECT COUNT(*) AS n FROM "${name}"`);
      sample[name] = Number(result.rows[0]?.n ?? 0);
    }
    console.info("[database-inspect] verified", JSON.stringify({
      tableCount: tableNames.length,
      tables: tableNames,
      counts: sample,
    }));
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error)
      .replace(/(?:libsql|https?):\/\/[^\s]+/g, "[redacted-url]")
      .slice(0, 500);
    console.error("[database-inspect] read failed:", message);
  } finally {
    client?.close();
  }
}
