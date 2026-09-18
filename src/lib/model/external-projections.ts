import "server-only";

import type { CanonicalMarket } from "@/lib/markets/types";

export interface ProjectionPoint {
  source: "fantasypros" | "covers";
  value: number;
  fetchedAt: string;
}

function normalizePerson(value: string) {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function decode(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFromCell(value: string) {
  const parsed = Number(decode(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 Lynerva/1.0" },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`projection source returned ${response.status}`);
  return response.text();
}

function fantasyProsPosition(family: CanonicalMarket["family"]) {
  if (family === "passing_yards" || family === "passing_touchdowns") return "qb";
  if (family === "rushing_yards") return "rb";
  if (family === "receiving_yards" || family === "receptions") return "wr";
  return null;
}

function fantasyProsValue(
  family: CanonicalMarket["family"],
  cells: string[],
) {
  const values = cells.slice(1).map(numberFromCell);
  if (family === "passing_yards") return values[2] ?? null;
  if (family === "passing_touchdowns") return values[3] ?? null;
  if (family === "rushing_yards") return values[1] ?? null;
  if (family === "receiving_yards") return values[1] ?? null;
  if (family === "receptions") return values[0] ?? null;
  return null;
}

async function fantasyProsProjection(
  market: CanonicalMarket,
  week: number | null,
): Promise<ProjectionPoint | null> {
  const preferred = fantasyProsPosition(market.family);
  const positions = preferred
    ? market.family === "receiving_yards" || market.family === "receptions"
      ? ["wr", "te", "rb"]
      : [preferred]
    : [];
  const target = normalizePerson(market.subject);
  for (const position of positions) {
    const url = `https://www.fantasypros.com/nfl/projections/${position}.php${week ? `?week=${week}` : ""}`;
    try {
      const html = await fetchText(url);
      const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
      for (const row of rows) {
        const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => decode(match[1] ?? ""));
        if (cells.length < 3) continue;
        const playerCell = normalizePerson(cells[0] ?? "");
        if (!playerCell.startsWith(target) && !target.startsWith(playerCell.replace(/\s+[a-z]{2,3}$/i, ""))) continue;
        const value = fantasyProsValue(market.family, cells);
        if (value !== null && value >= 0) {
          return { source: "fantasypros", value, fetchedAt: new Date().toISOString() };
        }
      }
    } catch (error) {
      console.error("FantasyPros projection unavailable", error);
    }
  }
  return null;
}

async function coversProjection(market: CanonicalMarket): Promise<ProjectionPoint | null> {
  try {
    const html = await fetchText("https://www.covers.com/sport/football/nfl/player-props");
    const target = market.subject.toLowerCase();
    const lower = html.toLowerCase();
    const index = lower.indexOf(target);
    if (index < 0) return null;
    const segment = decode(html.slice(Math.max(0, index - 1500), index + 7000));
    const familyLabel: Partial<Record<CanonicalMarket["family"], RegExp>> = {
      passing_yards: /passing yards/i,
      passing_touchdowns: /passing (?:tds|touchdowns)/i,
      rushing_yards: /rushing yards/i,
      receiving_yards: /receiving yards/i,
      receptions: /receptions/i,
      touchdowns: /anytime touchdown|touchdowns/i,
    };
    const label = familyLabel[market.family];
    if (label && !label.test(segment)) return null;
    const match = segment.match(/PROJECTION\s+(-?\d+(?:\.\d+)?)/i);
    const value = match ? Number(match[1]) : NaN;
    if (!Number.isFinite(value) || value < 0) return null;
    return { source: "covers", value, fetchedAt: new Date().toISOString() };
  } catch (error) {
    console.error("Covers projection unavailable", error);
    return null;
  }
}

export async function getExternalProjectionConsensus(
  market: CanonicalMarket,
  week: number | null,
) {
  const settled = await Promise.allSettled([
    fantasyProsProjection(market, week),
    coversProjection(market),
  ]);
  const points = settled
    .flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : [])
    .filter((point, index, all) => all.findIndex((candidate) => candidate.source === point.source) === index);
  if (!points.length) {
    return { projection: null, points: [] as ProjectionPoint[], dispersion: null };
  }
  const projection = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  const variance = points.reduce((sum, point) => sum + (point.value - projection) ** 2, 0) / points.length;
  return {
    projection,
    points,
    dispersion: points.length > 1 ? Math.sqrt(variance) : null,
  };
}
