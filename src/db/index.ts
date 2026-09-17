import "server-only";

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

let client: Client | undefined;
let database: LibSQLDatabase<typeof schema> | undefined;

function requireDatabaseUrl() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is required");
  }
  return url;
}

export function getDb() {
  if (!client) {
    client = createClient({
      url: requireDatabaseUrl(),
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  if (!database) {
    database = drizzle(client, { schema });
  }
  return database;
}

export type Database = ReturnType<typeof getDb>;
