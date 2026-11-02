import "server-only";

import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let database: PostgresJsDatabase<typeof schema> | undefined;

export function activeDatabaseUrl() {
  const url = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
  if (!url || !/^postgres(?:ql)?:\/\//.test(url)) {
    throw new Error("Neon PostgreSQL DATABASE_URL is required for Huddlemark");
  }
  return url;
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!database) {
    const client = postgres(activeDatabaseUrl(), {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
    });
    database = drizzle(client, { schema });
  }
  return database;
}

export type Database = ReturnType<typeof getDb>;
