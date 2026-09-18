import { ingestNflverseSeason } from "@/lib/nfl/nflverse";
import { runSourceLearningLoop } from "@/lib/model/source-learning";

export const runtime = "nodejs";

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const defaultSeason = new Date().getUTCFullYear();
  const season = Number(url.searchParams.get("season") ?? defaultSeason);
  const result = await ingestNflverseSeason(season);
  const learning = await runSourceLearningLoop(season);
  return Response.json({ ok: true, ...result, learning });
}

export const GET = handle;
export const POST = handle;
