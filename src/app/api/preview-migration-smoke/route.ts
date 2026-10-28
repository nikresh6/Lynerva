import { getFreshMarketOpportunities } from "@/lib/markets/service";
import { persistMarkets } from "@/lib/markets/persist";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const payload = await getFreshMarketOpportunities();
    const stored = payload.opportunities.length ? await persistMarkets(payload) : null;
    return Response.json({
      ok: Boolean(stored),
      fetchedAt: payload.fetchedAt,
      markets: payload.opportunities.length,
      providers: payload.providers.map((provider) => ({
        provider: provider.provider,
        count: provider.markets.length,
        error: provider.error,
      })),
      persistence: stored,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[preview-market-smoke] failed", error);
    return Response.json({ ok: false, error: "Preview market ingestion failed" }, { status: 500 });
  }
}
