import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/db";

let readiness: Promise<void> | null = null;

// Production schema is created by versioned PostgreSQL migrations, not from
// ad hoc SQLite DDL at the start of an authentication request.
export function ensureAuthDatabaseReady(): Promise<void> {
  if (!readiness) {
    readiness = getDb().execute(sql`SELECT 1 FROM "user" LIMIT 1`)
      .then(() => undefined)
      .catch((error) => {
        readiness = null;
        throw error;
      });
  }
  return readiness;
}
