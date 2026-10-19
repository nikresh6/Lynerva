# Huddlemark: Vercel deployment handoff

Created 2026-10-19. This document covers the hybrid deployment. Do not remove or disable Railway until database continuity and background processing have been verified.

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

The `HUDDLEMARK_DATABASE_URL` variable takes precedence. **Before considering Vercel production ready**, determine whether it is set to a local file or a remote database:

1. Check Railway **Huddlemark > Variables > `HUDDLEMARK_DATABASE_URL`**, or open https://huddlemark-production.up.railway.app/api/health and inspect `databaseMode`. The endpoint reports `persistent-local` if that URL starts with `file:` and `remote` otherwise. Note that `remote` by itself does not prove the database is accessible.
2. If it says `persistent-local`, the current tracker, learning, and history may reside on the Railway volume. Back up/export that database and migrate it into Turso before pointing Vercel at Turso. Ensure Railway's scheduler is switched to the same remote database only after validating data fidelity and a safe cutover.
3. If it says `remote`, verify that Vercel is configured to use the **same** remote database URL and that user/tracker rows are present. Do not assume the two named URL variables refer to the same database.
4. Only after data continuity has been proven should the Vercel host be used as the main site.

Vercel serverless functions do not share a durable `/data` volume. Recovery markers currently stored there stay on Railway. Vercel does not execute the app's `npm start` migration hook; the existing Railway startup handles migrations, or migrations must be run explicitly against the intended database before cutover.

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
