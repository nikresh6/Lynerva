import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.pg.ts",
  out: "./drizzle-pg",
  dbCredentials: {
    url: process.env.NEON_DATABASE_URL ?? "postgresql://unused:unused@localhost/unused",
  },
  strict: true,
  verbose: true,
});
