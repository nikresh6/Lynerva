# Lynerva

Lynerva is an NFL prediction-market research app. It normalizes live contracts from Kalshi and Polymarket, adds public NFL and weather context, estimates fair probabilities without copying market prices, and includes a private position tracker.

## Features

- Live Kalshi and Polymarket NFL markets in one comparable table
- Uncached executable market pricing with automatic page refresh
- Server-rendered filters with shareable URL parameters
- Contract detail drawer with implied odds, spread, model edge, and freshness
- Live NFL scoreboard and in-game market view
- Multi-leg return-range builder
- Email/password accounts and a private, server-authorized position tracker
- Turso/libSQL persistence through Drizzle ORM
- Current nflverse schedule and weekly player-stat ingestion
- Open-Meteo weather adapter and ESPN live-game adapter
- Resend password-reset email support
- Scheduled NFL ingestion and market snapshots through Vercel Cron

## Local setup

Requirements: Node.js 22, npm, and a Turso database.

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run data:nflverse
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
| `CRON_SECRET` | Secret used to authorize scheduled ingestion |
| `USE_MARKET_FIXTURES` | Optional development-only fixture switch |

Do not commit `.env.local`; it is ignored by Git.

## Live data

The Markets page fetches current Kalshi and Polymarket data directly on the server and refreshes every 10 seconds while visible. The Live page refreshes every 5 seconds. Kalshi market reads, Polymarket Gamma/CLOB reads, and ESPN live-game reads bypass the Next.js data cache.

The database is not used as the source of truth for current prices. It stores history, model inputs, predictions, and tracker data. Vercel Cron updates the current NFL season from nflverse daily and records a daily market snapshot as a fallback. Additional snapshots can be persisted when the application is actively used.

## Data and scheduled jobs

Generate and apply schema changes with:

```bash
npm run db:generate
npm run db:migrate
```

Import the current nflverse season with:

```bash
npm run data:nflverse
```

To import a specific historical season:

```bash
npm run data:nflverse -- 2025
```

The nflverse ingestion route defaults to the current year. Vercel invokes `/api/cron/nflverse` and `/api/cron/markets` daily. Both require the Vercel cron authorization header backed by `CRON_SECRET`.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Deployment

Import the GitHub repository into Vercel, add every variable from `.env.example`, set `BETTER_AUTH_URL` to the production domain, and deploy. The public market pages can build without database secrets, but authentication, the private tracker, historical ingestion, and model persistence require Turso at runtime.

Lynerva is a research tool, not financial advice. It does not place trades or hold funds.
