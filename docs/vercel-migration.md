# Huddlemark: Vercel deployment handoff

Created 2026-10-19. This document covers the hybrid deployment. Do not remove or disable Railway until database continuity and background processing have been verified.

## Current deployment: working hybrid (2026-10-19)

Huddlemark's **Vercel site is configured to serve the public frontend**, and all /api routes plus database-backed pages (/account, /results, /sources, /tracker, /reset-password) are proxied to **the original Railway server** using `next.config.ts` only when VERCEL=1. Railway continues reading/writing its **persistent local SQLite** volume, running its live collection and learning jobs, and handling Better Auth requests. Vercel no longer needs direct access to /data/huddlemark.db for these routed requests.

The proxy was tested via a Vercel preview and then merged as commit `43a530dc5d89386ee14b1d1d97886b2355d30dc7` (PR #62). The production Vercel deployment reached READY and the homepage, results, account, tracker, markets API, and unauthenticated session endpoint returned 200. This is **not a full backend or database migration**, and Railway should not be removed. An actual user sign-in, password reset and saved tracker edit were not exercised with credentials in the automated tests.

Vercel SSO protection is set to preview-only. Railway's production BETTER_AUTH_URL was changed to the new Vercel alias and the Vercel host was added to trusted origins.

**No user migration commands or Turso import are required for the current hybrid.** The full database export/import procedure below applies **only if later eliminating Railway**. Do not remove the Railway database override on Railway. Existing Vercel values `HUDDLEMARK_DATABASE_URL` and `RECOVER_WEEK_ON_START` are unnecessary to the proxy but are not exercised by the proxied endpoints.

## Accounts and services

- **Vercel project:** [huddlemark](https://vercel.com/nik-s-projects-858335de/huddlemark)
- **Vercel production alias:** https://huddlemark-nik-s-projects-858335de.vercel.app
- **Source:** [nikresh6/Lynerva](https://github.com/nikresh6/Lynerva), `main`
- **Build:** Next.js 16, Node.js 22, functions in `iad1`
- **Current Railway service:** Huddlemark in Railway project `scintillating-appreciation`, https://huddlemark-production.up.railway.app
- **Other Railway services:** `huddlemark-audit` and `lynerva-audit` (not part of Vercel deployment).

Vercel runs the website, server-rendered pages, and request-based APIs. Railway stays on to run the existing scheduler for Kalshi snapshots, scorecard locking, grading, learning, nflverse ingestion, and recovery work. The scheduler starts only with Railway runtime variables and does not start in Vercel serverless functions.

## Vercel environment variables

Configure variables directly in **Vercel > huddlemark > Settings > Environment Variables**. Never commit credentials or paste them into a ticket.

| Key | Status / purpose |
| --- | --- |
| `BETTER_AUTH_URL` | Already configured for **Production** to `https://huddlemark-nik-s-projects-858335de.vercel.app`. Change this if a custom domain becomes canonical. |
| `USE_MARKET_FIXTURES` | Already set to `false` for Production and Preview. |
| `TURSO_DATABASE_URL` | **You must supply** the URL of the production database if using Turso as the active database. |
| `TURSO_AUTH_TOKEN` | **You must supply** the authentication token for the active remote libSQL database. |
| `BETTER_AUTH_SECRET` | **You must supply** the production authentication secret. Use the existing one if sharing the same user database across hosts. |
| `RESEND_API_KEY` | Optional for page render, **required** for password-reset email delivery. |
| `EMAIL_FROM` | Optional for page render, **required** for password-reset email delivery. Must be a verified Resend sender. |
| `CRON_SECRET` | Only needed if intentionally invoking authenticated cron API endpoints. Railway currently runs its own scheduler. Keep unset if unused. |

If the active production database URL is a **remote** `HUDDLEMARK_DATABASE_URL` (rather than Turso URL), you can use that on Vercel instead of `TURSO_DATABASE_URL`, with the appropriate remote token. **Do not set an empty `HUDDLEMARK_DATABASE_URL`**, because the current code uses nullish coalescing and an empty value overrides the Turso fallback.

**Never copy these Railway-specific settings to Vercel:** `RAILWAY_*`, `RECOVER_WEEK_ON_START`, or any `file:/data/...` database URL.

## Critical database continuity check

Railway has a persistent 500 MB volume mounted at `/data`. Its service has *both* `HUDDLEMARK_DATABASE_URL` and `TURSO_DATABASE_URL` variable names configured. The Railway API connection exposes their names, not their values, so the active production database has not been established.

The `HUDDLEMARK_DATABASE_URL` variable takes precedence. **Before a complete Railway retirement**, determine whether it is set to a local file or a remote database:

1. Check Railway **Huddlemark > Variables > `HUDDLEMARK_DATABASE_URL`**, or open https://huddlemark-production.up.railway.app/api/health and inspect `databaseMode`. The endpoint reports `persistent-local` if that URL starts with `file:` and `remote` otherwise. Note that `remote` by itself does not prove the database is accessible.
2. If it says `persistent-local`, the current tracker, learning, and history may reside on the Railway volume. Back up/export that database and migrate it into Turso before pointing Vercel at Turso. Ensure Railway's scheduler is switched to the same remote database only after validating data fidelity and a safe cutover.
3. If it says `remote`, verify that Vercel is configured to use the **same** remote database URL and that user/tracker rows are present. Do not assume the two named URL variables refer to the same database.
4. Only after data continuity has been proven should the Vercel host be used as the main site.

Vercel serverless functions do not share a durable `/data` volume. Recovery markers currently stored there stay on Railway. Vercel does not execute the app's `npm start` migration hook; the existing Railway startup handles migrations, or migrations must be run explicitly against the intended database before cutover.

## Verified deployment audit (2026-10-19)

- **Vercel's new production deployment compiled and reached READY**, but this is not equivalent to a functioning application.
- **The production Vercel runtime has failed to open `/data/huddlemark.db`.** Both `/api/auth/get-session` and `/api/markets` logged `ConnectionFailed("Unable to open connection to local database /data/huddlemark.db: 14")`. Therefore the `HUDDLEMARK_DATABASE_URL` you entered in Vercel is the Railway-only local file URL and must be removed from Vercel **when the remote database has been prepared**.
- Railway's active scheduler logs confirm `"local":true` for storage maintenance with database footprint **97,615,872 bytes** on October 19. This is a real local database with data to migrate, not a hypothetical volume.
- Vercel's sensitive keys **exist** for `HUDDLEMARK_DATABASE_URL`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, and `RECOVER_WEEK_ON_START`. Their values were redacted by the platform. `RESEND_API_KEY` and `EMAIL_FROM` **have not been added** to Vercel. They are needed only for password-reset emails.
- `RECOVER_WEEK_ON_START` is a Railway-only recovery setting and should be removed from Vercel. No Vercel cron schedules should be enabled while Railway's scheduler is active.
- Vercel Deployment Protection still requires Vercel authentication on the `.vercel.app` hostname.
- The existing Railway deployment and volume were left intact.

### Safe cutover procedure

1. Keep the Railway service and background scheduler running, and do not delete its volume. Establish a maintenance window for the final snapshot and any writes during cutover.
2. In the Railway service shell, make a **consistent SQLite backup** of `/data/huddlemark.db`. Do not directly copy a live WAL-mode database file without its WAL or a database backup operation. If the `sqlite3` CLI exists, its online backup command can produce a consistent snapshot without interrupting readers:

   ```bash
   sqlite3 /data/huddlemark.db ".backup '/data/huddlemark-export.db'"
   sqlite3 /data/huddlemark-export.db "PRAGMA integrity_check;"
   ```

   The expected integrity result is `ok`. If the CLI is absent, install/use an appropriate SQLite backup tool in the service environment before continuing. Never delete the original.

3. With Railway CLI authenticated to your account, download the **backup** from the volume:

   ```bash
   railway volume files --volume huddlemark-data download /huddlemark-export.db ./huddlemark-export.db
   ```

4. Import that file into a **new** Turso database. Do not overwrite an existing production Turso database or reuse its name without verifying what it contains:

   ```bash
   turso db import ./huddlemark-export.db
   ```

5. Validate table counts and representative account, tracker, prediction, result, and learning rows against the source backup. Record a cutover time; reconcile writes made on Railway after the backup or take a fresh final snapshot with writes paused.
6. Set Vercel's `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the **imported** database. Delete `HUDDLEMARK_DATABASE_URL` from **Vercel only**, so the application actually uses Turso. Delete `RECOVER_WEEK_ON_START` from Vercel as well. Preserve the existing `BETTER_AUTH_SECRET` for accounts.
7. Redeploy Vercel and verify authentication, existing tracker rows, history, scorecards, and fresh market API requests with no database connection failures. Vercel functions cannot access Railway's `/data` volume.
8. After confirming Vercel works with the remote database and planning for zero data divergence, switch the Railway background worker to that same remote database at cutover, and confirm new scoring/learning writes are visible from Vercel. Railway should remain active for scheduling until a replacement has been verified.

Official guides: [Railway volume file download](https://docs.railway.com/cli/volume) and [Turso SQLite import](https://turso.tech/blog/migrating-and-importing-sqlite-to-turso-just-got-easier).

## Verification and activation checklist

- [ ] Enter required Vercel env variables under **Production**. Add preview-scoped credentials only when intentionally testing them.
- [ ] Trigger a new Vercel deployment. Env changes are not retroactive to deployments already built.
- [ ] Confirm the Railway production database mode, and reconcile/migrate saved history if needed.
- [ ] Compare existing account and tracker rows on both hosts, including private positions and manually entered P/L.
- [ ] Verify a fresh sign-in on the Vercel URL. Cookies are scoped by host, so users may need to sign in again.
- [ ] Verify live Kalshi markets, player props, scorecards, and in-game refresh.
- [ ] Verify ongoing scheduler/grading activity on Railway. No duplicate writers should be enabled on Vercel.
- [ ] Verify password reset via Resend, if configured.
- [ ] Check Vercel runtime errors and Railway logs.
- [ ] Vercel deployment protection currently requires Vercel authentication on the default `.vercel.app` hostname. Adjust project protection only when the app is ready for public traffic.

**Keep the existing Railway site and its `/data` volume intact until the migration is fully validated.** No DNS changes are required to test the new Vercel domain.
