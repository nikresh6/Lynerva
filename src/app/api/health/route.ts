import { NextResponse } from "next/server";
import { getLocalDatabaseStorageState } from "@/lib/db/storage-maintenance";

export const dynamic = "force-dynamic";

export async function GET() {
  const memory = process.memoryUsage();
  const storage = await getLocalDatabaseStorageState();
  const rssMb = Math.round(memory.rss / 1024 / 1024);
  const healthy = rssMb < 900 && !storage.emergency;

  return NextResponse.json(
    {
      ok: healthy,
      rssMb,
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      databaseMb: Math.round(storage.totalBytes / 1024 / 1024),
      databaseEmergency: storage.emergency,
    },
    { status: healthy ? 200 : 503 },
  );
}
