import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle-pg",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "postgresql://localhost/huddlemark",
  },
  strict: true,
  verbose: true,
});
