import "server-only";

import type { CanonicalMarket } from "@/lib/markets/types";

export interface ProjectionPoint {
  source: "fantasypros" | "numberfire";
  value: number;
  fetchedAt: string;
}

const PAGE_TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 30_000;
const CONSENSUS_TTL_MS = 10 * 60_000;
const SOURCE_TIMEOUT_MS = 1_600;

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

  const entry = {
    expiresAt: Date.now() + PAGE_TTL_MS,
    promise: fetch(url, {
      cache: "no-store",
      headers: { "user-agent": "Mozilla/5.0 Lynerva/1.0" },
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`projection source returned ${response.status}`);
      }
      return response.text();
    }),
  };

  pageCache.set(url, entry);
  entry.promise.catch(() => {
    const current = pageCache.get(url);
    if (current === entry) current.expiresAt = Date.now() + FAILURE_TTL_MS;
  });

  return entry.promise;
}

function rowsFromHtml(html: string) {
  return (html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (match) => decode(match[1] ?? ""),
    ),
  );
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
      return (values[2] ?? 0) + (values[5] ?? 0);
    }
  }

  if (position === "wr" || position === "te") {
    if (family === "receptions") return values[0] ?? null;
    if (family === "receiving_yards") return values[1] ?? null;
    if (family === "rushing_yards") return values[4] ?? null;
    if (family === "touchdowns") {
      return (values[2] ?? 0) + (position === "wr" ? values[5] ?? 0 : 0);
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
  const target = normalizePerson(market.subject);

  for (const position of fantasyProsPositions(market.family)) {
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
        const rows = rowsFromHtml(await fetchText(url));
        for (const cells of rows) {
          if (cells.length < 3) continue;
          const playerCell = normalizePerson(cells[0] ?? "");
          if (!playerCell.startsWith(target)) continue;

          const value = fantasyProsValue(market.family, position, cells);
          if (value !== null && value >= 0) {
            return {
              source: "fantasypros",
              value,
              fetchedAt: new Date().toISOString(),
            };
          }
        }
      } catch {
        // Shared source failures are expected occasionally. Another source can
        // still price the prop, and the failed page is briefly negative-cached.
      }
    }
  }

  return null;
}

function numberFirePositions(family: CanonicalMarket["family"]) {
  if (family === "passing_yards" || family === "passing_touchdowns") {
    return ["qb"];
  }
  if (family === "receiving_yards" || family === "receptions") {
    return ["wr", "te"];
  }
  if (family === "touchdowns") return ["rb", "wr", "te"];
  return [];
}

function numberFireValue(
  family: CanonicalMarket["family"],
  position: string,
  cells: string[],
  playerIndex: number,
) {
  // numberFire rows are rank, player, opponent, then position metrics.
  if (position === "qb") {
    if (family === "passing_yards") {
      return numberFromCell(cells[playerIndex + 2] ?? "");
    }
    if (family === "passing_touchdowns") {
      return numberFromCell(cells[playerIndex + 3] ?? "");
    }
  }

  if (position === "wr" || position === "te") {
    if (family === "receptions") {
      return numberFromCell(cells[playerIndex + 2] ?? "");
    }
    if (family === "receiving_yards") {
      return numberFromCell(cells[playerIndex + 3] ?? "");
    }
    if (family === "touchdowns") {
      return numberFromCell(cells[playerIndex + 4] ?? "");
    }
  }

  if (position === "rb" && family === "touchdowns") {
    return numberFromCell(cells[playerIndex + 3] ?? "");
  }

  return null;
}

async function numberFireProjection(
  market: CanonicalMarket,
): Promise<ProjectionPoint | null> {
  const target = normalizePerson(market.subject);

  for (const position of numberFirePositions(market.family)) {
    try {
      const url =
        `https://www.numberfire.com/external/widgets/top-players/${position}`;
      const rows = rowsFromHtml(await fetchText(url));

      for (const cells of rows) {
        const playerIndex = cells.findIndex((cell) =>
          normalizePerson(cell).startsWith(target),
        );
        if (playerIndex < 0) continue;

        const value = numberFireValue(
          market.family,
          position,
          cells,
          playerIndex,
        );
        if (value !== null && value >= 0) {
          return {
            source: "numberfire",
            value,
            fetchedAt: new Date().toISOString(),
          };
        }
      }
    } catch {
      // The consensus remains usable when either independent source is down.
    }
  }

  return null;
}

async function buildConsensus(
  market: CanonicalMarket,
  week: number | null,
) {
  const settled = await Promise.allSettled([
    fantasyProsProjection(market, week),
    numberFireProjection(market),
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
    if (current?.promise === promise) {
      current.expiresAt = Date.now() + FAILURE_TTL_MS;
    }
  });

  return promise;
}
