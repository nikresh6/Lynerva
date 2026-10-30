# Huddlemark temporary deployment outside Vercel

This branch prepares Huddlemark for a single long-lived Node.js host, such as a paid Render Web Service with an attached persistent disk.

## Why not Render Free?

The production application still uses libSQL/SQLite and has private historical data. Render Free has an ephemeral filesystem, spins down on inactivity, and cannot attach a persistent disk. That would lose Huddlemark's accounts, position tracker, Results history, and learning state on redeploy, restart, or idle spin-down. Do **not** serve real user data from a free local SQLite deployment. The incomplete Neon migration is not a drop-in replacement for the app's libSQL adapter.

## Deploy after confirming the host/workspace and paid disk plan

1. Create a **single instance** Render Node Web Service from GitHub `nikresh6/Lynerva`, branch `chore/render-temporary-host-20261030`. Choose a paid compute plan with a persistent disk mounted at `/var/data` (configure the disk in Render's dashboard), and Node 22.
2. Build command: `npm ci && npm run build`. Start command: `npm start`. Health path: `/api/health`. The new start script binds `0.0.0.0:$PORT` and applies libSQL schema migrations.
3. **Before pointing traffic at the new service**, securely import a fresh, consistent backup of the current Railway SQLite source into `/var/data/huddlemark.db`. A prior checked backup from October 2026 can be useful for recovery but may omit recent activity. Never commit the private database, user credentials, or secrets to this public repository.
4. Set Render runtime variables:
   - `HUDDLEMARK_DATABASE_URL=file:/var/data/huddlemark.db`
   - `BETTER_AUTH_URL=https://<render-service-host>.onrender.com`
   - `BETTER_AUTH_SECRET` to the existing application's secret (rotate deliberately if needed, which invalidates sessions)
   - `HUDDLEMARK_ENABLE_BACKGROUND_JOBS=true` only after switching the scheduler away from the previous host
   - `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM` as appropriate; use `USE_MARKET_FIXTURES=false`.
5. Confirm the imported data counts for `user_positions`, `prediction_results`, `weekly_scorecard_picks`, `predictions`, and `source_weight_history` against the source before any write traffic. Test login, Tracker CRUD, Picks, Results, and fresh API data. `/api/health` alone does not test database access.
6. Do not run two schedulers against the same dataset. Keep the Railway volume until the new host's data and background processing are confirmed. Disable the old instance only after verifying a clean cutover.
7. Switch the public DNS/custom domain after verification. Keep an independent, restorable SQLite backup.

Notes:
- Render's persistent disk is attached only at runtime, not during the build or pre-deploy phase. Avoid copying SQLite as a build artifact.
- `next.config.ts` only proxies to Railway when `VERCEL=1`. Render executes its own pages and API.
- Production changes to the existing Vercel deploy remain untouched by this branch.
- Before deploying, obtain explicit approval for any paid hosting or disk usage and confirm the destination Render workspace.
