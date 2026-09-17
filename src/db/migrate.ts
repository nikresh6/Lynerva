import "dotenv/config";

import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is required");

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
  client.close();
  console.log("Database migrations applied.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
