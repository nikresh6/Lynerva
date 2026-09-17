# Lynerva

Lynerva is an NFL prediction-market research app. It normalizes live contracts from Kalshi and Polymarket, adds public NFL and weather context, estimates fair probabilities without copying market prices, and includes a private position tracker.

## Features

- Live Kalshi and Polymarket NFL markets in one comparable table
- Server-rendered filters with shareable URL parameters
- Contract detail drawer with implied odds, spread, model edge, and freshness
- Live NFL scoreboard and in-game market view
- Multi-leg return-range builder
- Email/password accounts and a private, server-authorized position tracker
- Turso/libSQL persistence through Drizzle ORM
- nflverse historical schedule and player-stat ingestion
- Open-Meteo weather adapter and ESPN live-game adapter
- Resend password-reset email support
- Scheduled market snapshots through Vercel Cron

## Local setup

Requirements: Node.js 20.9 or newer, npm, and a Turso database.

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run data:nflverse -- 2024
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Live provider data is used by default. Set `USE_MARKET_FIXTURES=true` only when you need stable local demonstration data.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TURSO_DATABASE_URL` | Turso libSQL database URL |
| `TURSO_AUTH_TOKEN` | Turso database auth token |
| `RESEND_API_KEY` | Resend key used for password resets |
| `EMAIL_FROM` | Verified Resend sender, such as `Lynerva <account@example.com>` |
| `BETTER_AUTH_URL` | Canonical app URL; use the deployed HTTPS URL in production |
| `BETTER_AUTH_SECRET` | Long random secret used to sign auth data |
| `CRON_SECRET` | Secret accepted by ingestion cron endpoints |
| `USE_MARKET_FIXTURES` | Optional development-only fixture switch |

Do not commit `.env.local`; it is ignored by Git.

## Data and scheduled jobs

Generate and apply schema changes with:

```bash
npm run db:generate
npm run db:migrate
```

Import a historical nflverse season with:

```bash
npm run data:nflverse -- 2024
```

Vercel invokes `/api/cron/markets` daily using `vercel.json`. The route accepts Vercel's cron authorization header or a bearer token matching `CRON_SECRET`. Historical ingestion is also exposed at `/api/cron/nflverse?season=2024` and uses the same authorization.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Deployment

Import the GitHub repository into Vercel, add every variable from `.env.example` to the project, set `BETTER_AUTH_URL` to the production domain, and deploy. Add a verified domain sender to Resend before relying on password-reset delivery; Resend's testing sender is suitable only for its supported test flow.

Lynerva is a research tool, not financial advice. It does not place trades or hold funds.
