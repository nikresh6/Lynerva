/**
 * Copy an existing persistent SQLite/libSQL Huddlemark database to a newly
 * provisioned PostgreSQL database, without deleting or changing source rows.
 *
 * Intended to run INSIDE the Railway service, where /data is mounted.
 * Never export SQLite contents to logs or to a public HTTP endpoint.
 *
 * Required: HUDDLEMARK_DATABASE_URL=file:/data/..., NEON_DATABASE_URL
 *
 * Usage: node scripts/migrate-sqlite-to-neon.mjs --inspect
 *        node scripts/migrate-sqlite-to-neon.mjs --write
 *
 * Re-run after pausing source writes for a final reconciliation. Keep the
 * original volume until all counts and application smoke tests pass.
 */
import { createClient } from "@libsql/client";
import postgres from "postgres";

const write = process.argv.includes("--write");
const inspect = process.argv.includes("--inspect");
if (write === inspect) {
  throw new Error("Choose exactly one of --inspect or --write");
}

const sourceUrl = process.env.HUDDLEMARK_DATABASE_URL;
const destinationUrl = process.env.NEON_DATABASE_URL;
if (!sourceUrl?.startsWith("file:") || !sourceUrl.startsWith("file:/data/")) {
  throw new Error("Source must be an existing Railway persistent /data SQLite volume");
}
if (!destinationUrl?.startsWith("postgresql://") && !destinationUrl?.startsWith("postgres://")) {
  throw new Error("NEON_DATABASE_URL must be a PostgreSQL URL");
}

const sqlite = createClient({ url: sourceUrl });
const pg = postgres(destinationUrl, { max: 2, idle_timeout: 20, connect_timeout: 15 });

function quoteSqlite(name) {
  return '"' + name.replaceAll('"', '""') + '"';
}

function convert(value, type, table, column) {
  if (value === null || value === undefined) return null;
  if (type === "timestamp with time zone") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error("Invalid timestamp in " + table + "." + column);
    }
    return new Date(n * 1000);
  }
  if (type === "boolean") return value === true || value === 1 || value === "1";
  if (type === "jsonb") {
    // SQLite's json-mode text columns store serialized JSON. This conversion
    // preserves nested arrays/objects rather than double-encoding them.
    return typeof value === "string" ? JSON.parse(value) : value;
  }
  if (typeof value === "bigint") return String(value);
  return value;
}

async function main() {
  const sqlTables = await sqlite.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  const available = new Set(sqlTables.rows.map((r) => String(r.name)));
  const pgColumns = await pg`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;
  const columnsByTable = new Map();
  for (const c of pgColumns) {
    if (!columnsByTable.has(c.table_name)) columnsByTable.set(c.table_name, []);
    columnsByTable.get(c.table_name).push(c);
  }
  if (columnsByTable.size !== 23) {
    throw new Error("Expected 23 PostgreSQL app tables, found " + columnsByTable.size);
  }
  const foreignKeys = await pg`
    SELECT child.relname AS child, parent.relname AS parent
    FROM pg_constraint constraint
    JOIN pg_class child ON child.oid = constraint.conrelid
    JOIN pg_class parent ON parent.oid = constraint.confrelid
    WHERE constraint.contype = 'f'
      AND constraint.connamespace = 'public'::regnamespace
  `;
  const dependencies = new Map([...columnsByTable.keys()].map((table) => [table, new Set()]));
  for (const fk of foreignKeys) {
    if (fk.child !== fk.parent && dependencies.has(fk.child) && dependencies.has(fk.parent)) {
      dependencies.get(fk.child).add(fk.parent);
    }
  }
  const remaining = new Set(dependencies.keys());
  const ordered = [];
  while (remaining.size) {
    const next = [...remaining].find((table) =>
      [...dependencies.get(table)].every((dependency) => !remaining.has(dependency))
    );
    if (!next) throw new Error("Foreign key dependency cycle, cannot import safely");
    ordered.push(next);
    remaining.delete(next);
  }

  let sourceTotal = 0;
  let destinationTotal = 0;
  const summaries = [];
  for (const table of ordered) {
    if (!available.has(table)) {
      throw new Error("Source is missing table " + table + ", stopping before cutover");
    }
    const sqlColumnRows = await sqlite.execute("PRAGMA table_info(" + quoteSqlite(table) + ")");
    const sqlColumns = new Set(sqlColumnRows.rows.map((r) => String(r.name)));
    const columns = columnsByTable.get(table);
    const unexpected = columns.filter((c) => !sqlColumns.has(c.column_name));
    if (unexpected.length) {
      throw new Error("Missing SQLite columns in " + table + ": " +
        unexpected.map((c) => c.column_name).join(", "));
    }
    const from = await sqlite.execute("SELECT count(*) AS count FROM " + quoteSqlite(table));
    const sourceCount = Number(from.rows[0].count);
    if (!Number.isSafeInteger(sourceCount)) throw new Error("Invalid source count");
    sourceTotal += sourceCount;
    if (write) {
      const batchSize = 100;
      for (let offset = 0; offset < sourceCount; offset += batchSize) {
        const rows = await sqlite.execute({
          sql: "SELECT " + columns.map((c) => quoteSqlite(c.column_name)).join(", ") +
            " FROM " + quoteSqlite(table) + " ORDER BY rowid LIMIT ? OFFSET ?",
          args: [batchSize, offset],
        });
        const inserts = rows.rows.map((row) =>
          Object.fromEntries(columns.map((column) => [
            column.column_name,
            column.data_type === "jsonb"
              ? pg.json(convert(row[column.column_name], column.data_type, table, column.column_name))
              : convert(row[column.column_name], column.data_type, table, column.column_name),
          ]))
        );
        if (!inserts.length) throw new Error("Read fewer source rows than expected for " + table);
        const names = columns.map((c) => c.column_name);
        await pg`INSERT INTO ${pg(table)} ${pg(inserts, ...names)} ON CONFLICT DO NOTHING`;
      }
    }
    const dest = await pg`SELECT count(*)::bigint AS count FROM ${pg(table)}`;
    const destCount = Number(dest[0].count);
    destinationTotal += destCount;
    summaries.push({ table, sourceCount, destinationCount: destCount });
    if (write && destCount !== sourceCount) {
      throw new Error("Count mismatch in " + table + ": " + sourceCount + " vs " + destCount);
    }
    console.info("[neon-migration]", JSON.stringify(summaries.at(-1)));
  }
  console.info("[neon-migration] summary", JSON.stringify({
    mode: write ? "write" : "inspect",
    tableCount: summaries.length,
    sourceTotal,
    destinationTotal,
    verified: write && sourceTotal === destinationTotal,
  }));
}

try {
  await main();
} finally {
  await Promise.allSettled([pg.end({ timeout: 3 }), sqlite.close()]);
}
