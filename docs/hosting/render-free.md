# Huddlemark, $0 temporary hosting

Status (2026-10-30): **The free Render preview builds and runs, but it does not have a production database configured.** Do not treat its Picks, Results, or Tracker as verified until the database is connected and tests pass.

- Web host: Render Free, service `huddlemark-free-preview`, URL `https://huddlemark-free-preview.onrender.com`
- Source: this separate GitHub branch, not `main`.
- Suggested free database: Turso Free. Huddlemark's production code uses `@libsql/client` and `drizzle-orm/libsql`, so remote Turso is directly compatible.
- Persistent SQLite on Render Free is **not** compatible with data durability: free web service storage is ephemeral, and the service sleeps when idle. Do not use `file:` production databases or put actual account and betting data on its filesystem.

## Zero-cost database transfer

1. On a Turso Free account with available quota, use the Turso Cloud CLI to import a *fresh consistent* production SQLite backup: `turso db import /path/to/huddlemark.db`. The CLI uses WAL format for imports. Turso Free advertises 5GB storage, no credit card required, subject to usage caps.
2. The October 27 backup in the owner's ChatGPT Library was checked and a WAL-compatible copy was prepared, but it is **not up to date** with Railway activity from October 29. Importing it as production without reconciling newer writes risks rolling back saved positions and results.
3. Get the new database URL with `turso db show <database-name>` and generate a database token with `turso db tokens create <database-name>`.
4. Configure the **Render preview's environment**, not GitHub:
   - `HUDDLEMARK_DATABASE_URL=libsql://...` (the Turso database URL).
   - `TURSO_AUTH_TOKEN` (secret Turso database token).
   - `BETTER_AUTH_SECRET` (the **existing** Huddlemark Better Auth secret if retaining existing accounts; do not rotate casually).
   - `BETTER_AUTH_URL=https://huddlemark-free-preview.onrender.com`
   - `USE_MARKET_FIXTURES=false`.
   - `HUDDLEMARK_ENABLE_BACKGROUND_JOBS=false` initially, until reliable scheduling is configured and the previous scheduler is retired.
5. Redeploy after setting variables, then check /api/health, account sign-in, Picks, Live, Builder, Results, Tracker and data row counts. Health alone does not assert database connectivity. Avoid changing the production domain or killing Railway until the data and live flows have passed.
6. Schedule grading, scorecard locking and market refresh independently of the sleeping free web process; cron APIs alone do not cover all jobs now performed by the Railway in-process scheduler. Do not represent weekly scorecard data as current unless these jobs are confirmed running.

## Free-host limitations

Render Free provides 512MB RAM and a service may sleep after 15 minutes of inactivity; cold starts can be slow. Huddlemark previously exceeded 512MB on Railway under its background scheduler, so keeping the scheduler off helps, but does not guarantee stability under heavy model workloads. This is a temporary, best-effort development or hobby deployment, **not suitable for unattended real-money use** without validating reliability and history correctness.

## Preserve existing production

The existing Railway persistent volume is the last verified location of the newer production SQLite file. The Vercel deployment and `main` branch are unchanged, and the Render preview has no imported personal data as of 2026-10-30.
