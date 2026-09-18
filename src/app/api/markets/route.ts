import { getMarketOpportunities } from "@/lib/markets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getMarketOpportunities();
  return Response.json(payload, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
