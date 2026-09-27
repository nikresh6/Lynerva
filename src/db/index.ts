import "server-only";

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

let client: Client | undefined;
let database: LibSQLDatabase<typeof schema> | undefined;

function requireDatabaseUrl() {
  const url =
    process.env.HUDDLEMARK_DATABASE_URL ??
    process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "HUDDLEMARK_DATABASE_URL or TURSO_DATABASE_URL is required",
    );
  }
  return url;
}

function databaseClientConfig() {
  const url = requireDatabaseUrl();
  return {
    url,
    ...(url.startsWith("file:")
      ? {}
      : { authToken: process.env.TURSO_AUTH_TOKEN }),
  };
}

export function getDb() {
  if (!client) {
    const config = databaseClientConfig();
    if (config.url.startsWith("file:")) {
      console.info("[database] persistent local libSQL active");
    }
    client = createClient(config);
  }
  if (!database) {
    database = drizzle(client, { schema });
  }
  return database;
}

export type Database = ReturnType<typeof getDb>;
