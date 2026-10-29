import { gradeFinalEspnGames } from "@/lib/background/railway-scheduler";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await gradeFinalEspnGames();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[grading-cron] failed", error);
    return Response.json({ error: "Grading failed" }, { status: 500 });
  }
}
