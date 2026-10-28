import { lockEligibleScorecards } from "@/lib/model/scorecard";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await lockEligibleScorecards();
    return Response.json({ ok: true, result });
  } catch (error) {
    console.error("[scorecard-cron] failed", error);
    return Response.json({ error: "Scorecard lock failed" }, { status: 500 });
  }
}
