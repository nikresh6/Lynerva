import { getMarketOpportunities } from "@/lib/markets/service";
import { persistMarkets } from "@/lib/markets/persist";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const payload = await getMarketOpportunities();
  const stored = await persistMarkets(payload);
  return Response.json({
    ok: true,
    fetchedAt: payload.fetchedAt,
    providers: payload.providers.map((provider) => ({
      provider: provider.provider,
      markets: provider.markets.length,
      error: provider.error,
    })),
    ...stored,
  });
}
