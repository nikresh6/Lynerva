import { getTeamRoster } from "@/lib/nfl/player-visuals";
import { getNflTeam } from "@/lib/nfl/teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawTeam = searchParams.get("team") ?? "";
  const team = getNflTeam(rawTeam);

  if (!team) {
    return Response.json(
      { team: null, players: [] },
      { status: 400 },
    );
  }

  const players = await getTeamRoster(team.code);

  return Response.json(
    { team, players },
    {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
