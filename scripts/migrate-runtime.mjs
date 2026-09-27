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
  } catch (error) {
    const messages = [];
    const seen = new Set();
    let current = error;
    while (current && !seen.has(current)) {
      seen.add(current);
      if (current instanceof Error) {
        messages.push(current.message);
        current = current.cause;
      } else {
        messages.push(String(current));
        break;
      }
    }
    const message = messages.join(" ");
    if (/BLOCKED|reads are blocked|writes are blocked/i.test(message)) {
      console.warn(
        "Database quota is currently blocking SQL. Starting the app without applying pending migrations.",
      );
      return;
    }
    throw error;
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
