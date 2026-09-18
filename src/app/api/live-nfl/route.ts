import { getLiveNflGames } from "@/lib/nfl/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const games = await getLiveNflGames();
  return Response.json({ games, fetchedAt: new Date().toISOString() }, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
