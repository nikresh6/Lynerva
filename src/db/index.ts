import "server-only";

import postgres, { type Sql } from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let client: Sql | undefined;
let database: PostgresJsDatabase<typeof schema> | undefined;

export function activeDatabaseUrl() {
  const url = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url?.startsWith("postgres")) {
    throw new Error("NEON_DATABASE_URL (PostgreSQL) is required for Huddlemark.");
  }
  return url;
}

export function getDb() {
  if (!client) {
    client = postgres(activeDatabaseUrl(), {
      max: 3,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 12,
    });
  }
  if (!database) {
    database = drizzle(client, { schema });
  }
  return database;
}

export type Database = ReturnType<typeof getDb>;
