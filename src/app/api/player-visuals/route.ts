import { getPlayerVisuals } from "@/lib/nfl/player-visuals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const names = (searchParams.get("names") ?? "")
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 60);

  const players = await getPlayerVisuals(names);

  return Response.json(
    { players },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
