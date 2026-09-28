import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const memory = process.memoryUsage();
  return NextResponse.json(
    {
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      databaseMode: process.env.HUDDLEMARK_DATABASE_URL?.startsWith("file:")
        ? "persistent-local"
        : "remote",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
