import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is required");
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Database migrations applied.");
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
