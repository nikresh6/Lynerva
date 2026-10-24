import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stateFile = "/tmp/huddlemark-neon-transfer-status.json";
const outputFile = "/tmp/huddlemark-neon-transfer-output.txt";

type JobState = {
  mode: "inspect" | "write";
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
};

let running = false;

function authorize(request: Request) {
  const expected = process.env.NEON_MIGRATION_TOKEN;
  const provided = request.headers.get("x-neon-migration-token");
  if (!expected || expected.length < 48 || !provided || provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

async function readState(): Promise<JobState | null> {
  try {
    return JSON.parse(await readFile(stateFile, "utf8")) as JobState;
  } catch {
    return null;
  }
}

async function responseStatus() {
  const state = await readState();
  let lines: string[] = [];
  try {
    const output = await readFile(outputFile, "utf8");
    lines = output.split("\n").filter((s) => s.includes("[neon-migration]")).slice(-28);
  } catch {
    // No process logs yet.
  }
  return Response.json({ state, lines }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (!authorize(request)) return new Response("Unauthorized", { status: 401 });
  return responseStatus();
}

export async function POST(request: Request) {
  if (!authorize(request)) return new Response("Unauthorized", { status: 401 });
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode !== "inspect" && mode !== "write") {
    return Response.json({ error: "mode must be inspect or write" }, { status: 400 });
  }
  if (running || (await readState())?.status === "running") {
    return Response.json({ error: "migration already running" }, { status: 409 });
  }
  if (!process.env.HUDDLEMARK_DATABASE_URL?.startsWith("file:/data/") ||
      !process.env.NEON_DATABASE_URL?.startsWith("postgres")) {
    return Response.json({ error: "Migration source or target not configured" }, { status: 503 });
  }

  const state: JobState = { mode, status: "running", startedAt: new Date().toISOString() };
  running = true;
  await writeFile(stateFile, JSON.stringify(state));
  await writeFile(outputFile, "");
  const child = spawn(process.execPath, [join(process.cwd(), "scripts/migrate-sqlite-to-neon.mjs"), "--" + mode], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const append = async (stream: NodeJS.ReadableStream) => {
    for await (const chunk of stream) {
      // The transfer utility logs only table counts, not user records or secrets.
      const text = Buffer.from(chunk).toString("utf8");
      await import("node:fs/promises").then(({ appendFile }) => appendFile(outputFile, text));
    }
  };
  const streams = Promise.allSettled([append(child.stdout), append(child.stderr)]);
  child.on("error", async (error) => {
    running = false;
    await writeFile(stateFile, JSON.stringify({ ...state, status: "failed", finishedAt: new Date().toISOString(), error: error.message }));
  });
  child.on("exit", async (code) => {
    await streams;
    running = false;
    await writeFile(stateFile, JSON.stringify({ ...state, status: code === 0 ? "completed" : "failed", exitCode: code, finishedAt: new Date().toISOString() }));
  });
  return Response.json({ started: true, mode, status: "running" }, { status: 202 });
}
