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
      databaseMode: /^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "")
        ? "remote"
        : "unconfigured",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
