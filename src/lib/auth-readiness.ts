import "server-only";

import { createClient } from "@libsql/client";

let readiness: Promise<void> | null = null;

async function prepareAuthDatabase() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is required for Huddlemark account authentication.",
    );
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  try {
    await client.batch(
      [
        `CREATE TABLE IF NOT EXISTS "user" (
          "id" text PRIMARY KEY NOT NULL,
          "name" text NOT NULL,
          "email" text NOT NULL,
          "email_verified" integer DEFAULT false NOT NULL,
          "image" text,
          "created_at" integer DEFAULT (unixepoch()) NOT NULL,
          "updated_at" integer DEFAULT (unixepoch()) NOT NULL
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique" ON "user" ("email")`,
        `CREATE TABLE IF NOT EXISTS "session" (
          "id" text PRIMARY KEY NOT NULL,
          "expires_at" integer NOT NULL,
          "token" text NOT NULL,
          "created_at" integer DEFAULT (unixepoch()) NOT NULL,
          "updated_at" integer DEFAULT (unixepoch()) NOT NULL,
          "ip_address" text,
          "user_agent" text,
          "user_id" text NOT NULL,
          FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "session_token_unique" ON "session" ("token")`,
        `CREATE INDEX IF NOT EXISTS "session_user_idx" ON "session" ("user_id")`,
        `CREATE INDEX IF NOT EXISTS "session_expiry_idx" ON "session" ("expires_at")`,
        `CREATE TABLE IF NOT EXISTS "account" (
          "id" text PRIMARY KEY NOT NULL,
          "account_id" text NOT NULL,
          "provider_id" text NOT NULL,
          "user_id" text NOT NULL,
          "access_token" text,
          "refresh_token" text,
          "id_token" text,
          "access_token_expires_at" integer,
          "refresh_token_expires_at" integer,
          "scope" text,
          "password" text,
          "created_at" integer DEFAULT (unixepoch()) NOT NULL,
          "updated_at" integer DEFAULT (unixepoch()) NOT NULL,
          FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE no action ON DELETE cascade
        )`,
        `CREATE INDEX IF NOT EXISTS "account_user_idx" ON "account" ("user_id")`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_unique" ON "account" ("provider_id","account_id")`,
        `CREATE TABLE IF NOT EXISTS "verification" (
          "id" text PRIMARY KEY NOT NULL,
          "identifier" text NOT NULL,
          "value" text NOT NULL,
          "expires_at" integer NOT NULL,
          "created_at" integer DEFAULT (unixepoch()) NOT NULL,
          "updated_at" integer DEFAULT (unixepoch()) NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier")`,
        `CREATE INDEX IF NOT EXISTS "verification_expiry_idx" ON "verification" ("expires_at")`,
      ],
      "write",
    );
  } finally {
    client.close();
  }
}

export function ensureAuthDatabaseReady() {
  if (!readiness) {
    readiness = prepareAuthDatabase().catch((error) => {
      readiness = null;
      throw error;
    });
  }
  return readiness;
}
