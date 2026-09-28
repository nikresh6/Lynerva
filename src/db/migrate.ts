import "dotenv/config";

import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql";

async function main() {
  const url =
    process.env.HUDDLEMARK_DATABASE_URL ??
    process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "HUDDLEMARK_DATABASE_URL or TURSO_DATABASE_URL is required",
    );
  }

  const client = createClient({
    url,
    ...(url.startsWith("file:")
      ? {}
      : { authToken: process.env.TURSO_AUTH_TOKEN }),
  });
  if (url.startsWith("file:")) {
    await client.execute("PRAGMA auto_vacuum = INCREMENTAL");
    await client.execute("PRAGMA journal_mode = WAL");
    await client.execute("PRAGMA synchronous = NORMAL");
    await client.execute("PRAGMA busy_timeout = 5000");
  }
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./drizzle" });
  client.close();
  console.log("Database migrations applied.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
