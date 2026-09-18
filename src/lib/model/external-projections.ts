import "server-only";

import type { CanonicalMarket } from "@/lib/markets/types";

export interface ProjectionPoint {
  source: "fantasypros" | "covers";
  value: number;
  fetchedAt: string;
}

const PAGE_TTL_MS = 10 * 60_000;
const CONSENSUS_TTL_MS = 10 * 60_000;

const pageCache = new Map<
  string,
  { expiresAt: number; promise: Promise<string> }
>();
const consensusCache = new Map<
  string,
  {
    expiresAt: number;
    promise: Promise<{
      projection: number | null;
      points: ProjectionPoint[];
      dispersion: number | null;
    }>;
  }
>();

function normalizePerson(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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
  const parsed = Number(
    decode(value)
      .replace(/,/g, "")
      .match(/-?\d+(?:\.\d+)?/)?.[0],
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function fetchText(url: string) {
  const cached = pageCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 Lynerva/1.0" },
    signal: AbortSignal.timeout(4_500),
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`projection source returned ${response.status}`);
    }
    return response.text();
  });

  pageCache.set(url, {
    expiresAt: Date.now() + PAGE_TTL_MS,
    promise,
  });

  promise.catch(() => {
    const current = pageCache.get(url);
    if (current?.promise === promise) pageCache.delete(url);
  });

  return promise;
}

function fantasyProsPositions(family: CanonicalMarket["family"]) {
  if (family === "passing_yards" || family === "passing_touchdowns") {
    return ["qb"];
  }
  if (family === "rushing_yards") return ["rb", "qb", "wr"];
  if (family === "receiving_yards" || family === "receptions") {
    return ["wr", "te", "rb"];
  }
  if (family === "touchdowns") return ["rb", "wr", "te"];
  return [];
}

function fantasyProsValue(
  family: CanonicalMarket["family"],
  position: string,
  cells: string[],
) {
  const values = cells.slice(1).map(numberFromCell);

  if (family === "passing_yards") return values[2] ?? null;
  if (family === "passing_touchdowns") return values[3] ?? null;

  if (position === "rb") {
    if (family === "rushing_yards") return values[1] ?? null;
    if (family === "receptions") return values[3] ?? null;
    if (family === "receiving_yards") return values[4] ?? null;
    if (family === "touchdowns") {
      const rushing = values[2] ?? 0;
      const receiving = values[5] ?? 0;
      return rushing + receiving;
    }
  }

  if (position === "wr" || position === "te") {
    if (family === "receptions") return values[0] ?? null;
    if (family === "receiving_yards") return values[1] ?? null;
    if (family === "rushing_yards") return values[4] ?? null;
    if (family === "touchdowns") {
      const receiving = values[2] ?? 0;
      const rushing = position === "wr" ? values[5] ?? 0 : 0;
      return receiving + rushing;
    }
  }

  if (position === "qb" && family === "rushing_yards") {
    return values[6] ?? null;
  }

  return null;
}

async function fantasyProsProjection(
  market: CanonicalMarket,
  week: number | null,
): Promise<ProjectionPoint | null> {
  const positions = fantasyProsPositions(market.family);
  const target = normalizePerson(market.subject);

  for (const position of positions) {
    const urls = [
      `https://www.fantasypros.com/nfl/projections/${position}.php`,
      ...(week
        ? [
            `https://www.fantasypros.com/nfl/projections/${position}.php?week=${week}`,
          ]
        : []),
    ];

    for (const url of urls) {
      try {
        const html = await fetchText(url);
        const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];

        for (const row of rows) {
          const cells = [
            ...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi),
          ].map((match) => decode(match[1] ?? ""));

          if (cells.length < 3) continue;
          const playerCell = normalizePerson(cells[0] ?? "");
          const playerWithoutTeam = playerCell.replace(/\s+[a-z]{2,3}(?:\s+.*)?$/i, "");

          if (
            !playerCell.startsWith(target) &&
            !target.startsWith(playerWithoutTeam)
          ) {
            continue;
          }

          const value = fantasyProsValue(market.family, position, cells);
          if (value !== null && value >= 0) {
            return {
              source: "fantasypros",
              value,
              fetchedAt: new Date().toISOString(),
            };
          }
        }
      } catch (error) {
        console.error("FantasyPros projection unavailable", error);
      }
    }
  }

  return null;
}

async function coversProjection(
  market: CanonicalMarket,
): Promise<ProjectionPoint | null> {
  try {
    const html = await fetchText(
      "https://www.covers.com/sport/football/nfl/player-props",
    );
    const decoded = decode(html);
    const target = market.subject.toLowerCase();
    const lower = decoded.toLowerCase();
    const index = lower.indexOf(target);
    if (index < 0) return null;

    const segment = decoded.slice(
      Math.max(0, index - 1_500),
      index + 7_000,
    );
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

    const projectionMatches = [
      ...segment.matchAll(/PROJECTION\s+(-?\d+(?:\.\d+)?)/gi),
    ];
    const candidate = projectionMatches
      .map((match) => Number(match[1]))
      .find((value) => Number.isFinite(value) && value >= 0);

    if (candidate === undefined) return null;

    return {
      source: "covers",
      value: candidate,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Covers projection unavailable", error);
    return null;
  }
}

async function buildConsensus(
  market: CanonicalMarket,
  week: number | null,
) {
  const settled = await Promise.allSettled([
    fantasyProsProjection(market, week),
    coversProjection(market),
  ]);

  const points = settled
    .flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    )
    .filter(
      (point, index, all) =>
        all.findIndex((candidate) => candidate.source === point.source) ===
        index,
    );

  if (!points.length) {
    return {
      projection: null,
      points: [] as ProjectionPoint[],
      dispersion: null,
    };
  }

  const projection =
    points.reduce((sum, point) => sum + point.value, 0) / points.length;
  const variance =
    points.reduce(
      (sum, point) => sum + (point.value - projection) ** 2,
      0,
    ) / points.length;

  return {
    projection,
    points,
    dispersion: points.length > 1 ? Math.sqrt(variance) : null,
  };
}

export function getExternalProjectionConsensus(
  market: CanonicalMarket,
  week: number | null,
) {
  const key = [
    normalizePerson(market.subject),
    market.family,
    market.statistic ?? "",
    week ?? "current",
  ].join(":");

  const cached = consensusCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = buildConsensus(market, week);
  consensusCache.set(key, {
    expiresAt: Date.now() + CONSENSUS_TTL_MS,
    promise,
  });

  promise.catch(() => {
    const current = consensusCache.get(key);
    if (current?.promise === promise) consensusCache.delete(key);
  });

  return promise;
}
