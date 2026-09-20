import { toNextJsHandler } from "better-auth/next-js";
import { ensureAuthDatabaseReady } from "@/lib/auth-readiness";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(method: "GET" | "POST", request: Request) {
  await ensureAuthDatabaseReady();
  const handlers = toNextJsHandler(getAuth());
  return handlers[method](request);
}

export function GET(request: Request) {
  return handler("GET", request);
}

export function POST(request: Request) {
  return handler("POST", request);
}
