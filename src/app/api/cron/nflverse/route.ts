import { ingestNflverseSeason } from "@/lib/nfl/nflverse";

export const runtime = "nodejs";
export const maxDuration = 300;

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const defaultSeason = new Date().getUTCFullYear();
  const season = Number(url.searchParams.get("season") ?? defaultSeason);
  const result = await ingestNflverseSeason(season);
  return Response.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
