import "server-only";

import type { CanonicalMarket } from "@/lib/markets/types";

export type ProjectionSource =
  | "fantasypros"
  | "numberfire"
  | "espn"
  | "cbs"
  | "fftoday"
  | "nfl";

export interface ProjectionPoint {
  source: ProjectionSource;
  value: number;
  fetchedAt: string;
}

interface ProjectionStats {
  passingYards?: number;
  passingTouchdowns?: number;
  rushingYards?: number;
  rushingTouchdowns?: number;
  receptions?: number;
  receivingYards?: number;
  receivingTouchdowns?: number;
}

type ProjectionMap = Map<string, ProjectionStats>;

const PAGE_TTL_MS = 20 * 60_000;
const FAILURE_TTL_MS = 30_000;
const CONSENSUS_TTL_MS = 20 * 60_000;
const SOURCE_TIMEOUT_MS = 1_200;

const pageCache = new Map<
  string,
  { expiresAt: number; promise: Promise<string> }
>();
const jsonCache = new Map<
  string,
  { expiresAt: number; promise: Promise<unknown> }
>();
const sourceCache = new Map<
  string,
  { expiresAt: number; promise: Promise<ProjectionMap> }
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
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
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
    .replace(/&#x27;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowsFromHtml(html: string) {
  return (html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []).map((row) =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (match) => decode(match[1] ?? ""),
    ),
  );
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

function fetchJson(
  key: string,
  url: string,
  headers: Record<string, string>,
) {
  const cached = jsonCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = {
    expiresAt: Date.now() + PAGE_TTL_MS,
    promise: fetch(url, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`projection source returned ${response.status}`);
      }
      return response.json() as Promise<unknown>;
    }),
  };
  jsonCache.set(key, entry);
  entry.promise.catch(() => {
    const current = jsonCache.get(key);
    if (current === entry) current.expiresAt = Date.now() + FAILURE_TTL_MS;
  });
  return entry.promise;
}

function mergeStats(
  map: ProjectionMap,
  player: string,
  next: ProjectionStats,
) {
  const key = normalizePerson(player);
  if (!key) return;
  map.set(key, { ...(map.get(key) ?? {}), ...next });
}

function sourceValue(
  stats: ProjectionStats | undefined,
  family: CanonicalMarket["family"],
) {
  if (!stats) return null;
  if (family === "passing_yards") return stats.passingYards ?? null;
  if (family === "passing_touchdowns") return stats.passingTouchdowns ?? null;
  if (family === "rushing_yards") return stats.rushingYards ?? null;
  if (family === "receptions") return stats.receptions ?? null;
  if (family === "receiving_yards") return stats.receivingYards ?? null;
  if (family === "touchdowns") {
    const rushing = stats.rushingTouchdowns ?? 0;
    const receiving = stats.receivingTouchdowns ?? 0;
    const total = rushing + receiving;
    return total > 0 ? total : null;
  }
  return null;
}

function cachedSource(
  source: ProjectionSource,
  season: number,
  week: number,
  loader: () => Promise<ProjectionMap>,
) {
  const key = `${source}:${season}:${week}`;
  const cached = sourceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = loader()
    .then((map) => {
      console.info("Projection source loaded", source, map.size);
      return map;
    })
    .catch((error) => {
      console.error("Projection source failed", source, error);
      return new Map<string, ProjectionStats>();
    });
  sourceCache.set(key, {
    expiresAt: Date.now() + PAGE_TTL_MS,
    promise,
  });
  return promise;
}

function fantasyProsStats(position: string, cells: string[]): ProjectionStats {
  const values = cells.slice(1).map(toNumber);
  if (position === "qb") {
    return {
      passingYards: values[2] ?? undefined,
      passingTouchdowns: values[3] ?? undefined,
      rushingYards: values[6] ?? undefined,
      rushingTouchdowns: values[7] ?? undefined,
    };
  }
  if (position === "rb") {
    return {
      rushingYards: values[1] ?? undefined,
      rushingTouchdowns: values[2] ?? undefined,
      receptions: values[3] ?? undefined,
      receivingYards: values[4] ?? undefined,
      receivingTouchdowns: values[5] ?? undefined,
    };
  }
  return {
    receptions: values[0] ?? undefined,
    receivingYards: values[1] ?? undefined,
    receivingTouchdowns: values[2] ?? undefined,
    rushingYards: values[4] ?? undefined,
    rushingTouchdowns: values[5] ?? undefined,
  };
}

function loadFantasyPros(season: number, week: number) {
  return cachedSource("fantasypros", season, week, async () => {
    const map: ProjectionMap = new Map();
    await Promise.all(
      ["qb", "rb", "wr", "te"].map(async (position) => {
        const urls = [
          `https://www.fantasypros.com/nfl/projections/${position}.php?week=${week}`,
          `https://www.fantasypros.com/nfl/projections/${position}.php`,
        ];
        for (const url of urls) {
          try {
            const rows = rowsFromHtml(await fetchText(url));
            let found = 0;
            for (const cells of rows) {
              if (cells.length < 3) continue;
              const player = cells[0]?.replace(/\s+[A-Z]{2,3}\s*$/i, "").trim();
              if (!player) continue;
              const stats = fantasyProsStats(position, cells);
              if (Object.values(stats).some((value) => value !== undefined)) {
                mergeStats(map, player, stats);
                found += 1;
              }
            }
            if (found) break;
          } catch {
            // Try the fallback page.
          }
        }
      }),
    );
    return map;
  });
}

function loadNumberFire(season: number, week: number) {
  return cachedSource("numberfire", season, week, async () => {
    const map: ProjectionMap = new Map();
    await Promise.all(
      ["qb", "rb", "wr", "te"].map(async (position) => {
        try {
          const rows = rowsFromHtml(
            await fetchText(
              `https://www.numberfire.com/external/widgets/top-players/${position}`,
            ),
          );
          for (const cells of rows) {
            const playerIndex = cells.findIndex((cell) =>
              /^[A-Za-z.'’ -]{4,}$/.test(cell),
            );
            if (playerIndex < 0) continue;
            const player = cells[playerIndex] ?? "";
            if (position === "qb") {
              mergeStats(map, player, {
                passingYards: toNumber(cells[playerIndex + 2]) ?? undefined,
                passingTouchdowns: toNumber(cells[playerIndex + 3]) ?? undefined,
              });
            } else if (position === "wr" || position === "te") {
              mergeStats(map, player, {
                receptions: toNumber(cells[playerIndex + 2]) ?? undefined,
                receivingYards: toNumber(cells[playerIndex + 3]) ?? undefined,
                receivingTouchdowns: toNumber(cells[playerIndex + 4]) ?? undefined,
              });
            } else {
              mergeStats(map, player, {
                rushingTouchdowns: toNumber(cells[playerIndex + 3]) ?? undefined,
              });
            }
          }
        } catch {
          // Source remains optional.
        }
      }),
    );
    return map;
  });
}

function loadEspn(season: number, week: number) {
  return cachedSource("espn", season, week, async () => {
    const map: ProjectionMap = new Map();
    const positions = [
      ["QB", 0, 42],
      ["RB", 2, 100],
      ["WR", 4, 150],
      ["TE", 6, 60],
    ] as const;

    await Promise.all(
      positions.map(async ([position, slotId, limit]) => {
        const filter = {
          players: {
            filterSlotIds: { value: [slotId] },
            filterStatsForSourceIds: { value: [1] },
            filterStatsForSplitTypeIds: { value: [1] },
            sortAppliedStatTotal: {
              sortAsc: false,
              sortPriority: 3,
              value: `11${season}${week}`,
            },
            limit,
            offset: 0,
            filterStatsForTopScoringPeriodIds: {
              value: week,
              additionalValue: [
                `00${season}`,
                `10${season}`,
                `11${season}${week}`,
                `02${season}`,
              ],
            },
          },
        };
        const url =
          `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?scoringPeriodId=0&view=kona_player_info`;
        try {
          const payload = (await fetchJson(
            `espn:${season}:${week}:${position}`,
            url,
            {
              Accept: "application/json",
              "User-Agent": "Lynerva/1.0",
              "X-Fantasy-Source": "kona",
              "X-Fantasy-Filter": JSON.stringify(filter),
            },
          )) as {
            players?: Array<{
              player?: {
                fullName?: string;
                stats?: Array<{
                  statSourceId?: number;
                  statSplitTypeId?: number;
                  stats?: Record<string, number>;
                }>;
              };
            }>;
          };

          for (const entry of payload.players ?? []) {
            const player = entry.player;
            if (!player?.fullName) continue;
            const projection =
              player.stats?.find(
                (stat) =>
                  stat.statSourceId === 1 &&
                  stat.statSplitTypeId === 1 &&
                  Object.keys(stat.stats ?? {}).length > 0,
              ) ?? player.stats?.find((stat) => Object.keys(stat.stats ?? {}).length > 0);
            const stats = projection?.stats;
            if (!stats) continue;
            mergeStats(map, player.fullName, {
              passingYards: toNumber(stats["3"]) ?? undefined,
              passingTouchdowns: toNumber(stats["4"]) ?? undefined,
              rushingYards: toNumber(stats["24"]) ?? undefined,
              rushingTouchdowns: toNumber(stats["25"]) ?? undefined,
              receptions: toNumber(stats["53"]) ?? undefined,
              receivingYards: toNumber(stats["42"]) ?? undefined,
              receivingTouchdowns: toNumber(stats["43"]) ?? undefined,
            });
          }
        } catch {
          // Source remains optional.
        }
      }),
    );
    return map;
  });
}

const CBS_STAT_LABELS = {
  passingYards: /passing yards/i,
  passingTouchdowns: /touchdowns passes|passing touchdowns/i,
  rushingYards: /rushing yards/i,
  rushingTouchdowns: /rushing touchdowns/i,
  receptions: /^receptions$|\breceptions\b/i,
  receivingYards: /receiving yards/i,
  receivingTouchdowns: /receiving touchdowns/i,
} satisfies Record<keyof ProjectionStats, RegExp>;

function loadCbs(season: number, week: number) {
  return cachedSource("cbs", season, week, async () => {
    const map: ProjectionMap = new Map();
    await Promise.all(
      ["QB", "RB", "WR", "TE"].map(async (position) => {
        try {
          const html = await fetchText(
            `https://www.cbssports.com/fantasy/football/stats/${position}/${season}/${week}/projections/nonppr/`,
          );
          const thead = html.match(/<thead\b[\s\S]*?<\/thead>/i)?.[0] ?? "";
          const headers = [
            ...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi),
          ].map((match) => decode(match[1] ?? ""));
          const indices = Object.fromEntries(
            Object.entries(CBS_STAT_LABELS).map(([key, regex]) => [
              key,
              headers.findIndex((header) => regex.test(header)),
            ]),
          ) as Record<keyof ProjectionStats, number>;

          for (const row of html.match(/<tr\b[^>]*TableBase-bodyTr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
            const nameMatch = row.match(
              /CellPlayerName--long[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
            );
            const player = nameMatch ? decode(nameMatch[1] ?? "") : "";
            if (!player) continue;
            const cells = [
              ...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),
            ].map((match) => decode(match[1] ?? ""));
            const stats: ProjectionStats = {};
            for (const key of Object.keys(indices) as Array<keyof ProjectionStats>) {
              const index = indices[key];
              if (index >= 0) {
                const value = toNumber(cells[index]);
                if (value !== null) stats[key] = value;
              }
            }
            mergeStats(map, player, stats);
          }
        } catch {
          // Source remains optional.
        }
      }),
    );
    return map;
  });
}

function fftodayStats(position: string, cells: string[]): ProjectionStats {
  const values = cells.slice(4).map(toNumber);
  if (position === "QB") {
    return {
      passingYards: values[2] ?? undefined,
      passingTouchdowns: values[3] ?? undefined,
      rushingYards: values[6] ?? undefined,
      rushingTouchdowns: values[7] ?? undefined,
    };
  }
  if (position === "RB") {
    return {
      rushingYards: values[1] ?? undefined,
      rushingTouchdowns: values[2] ?? undefined,
      receptions: values[3] ?? undefined,
      receivingYards: values[4] ?? undefined,
      receivingTouchdowns: values[5] ?? undefined,
    };
  }
  if (position === "WR") {
    return {
      receptions: values[0] ?? undefined,
      receivingYards: values[1] ?? undefined,
      receivingTouchdowns: values[2] ?? undefined,
      rushingYards: values[4] ?? undefined,
      rushingTouchdowns: values[5] ?? undefined,
    };
  }
  return {
    receptions: values[0] ?? undefined,
    receivingYards: values[1] ?? undefined,
    receivingTouchdowns: values[2] ?? undefined,
  };
}

function loadFfToday(season: number, week: number) {
  return cachedSource("fftoday", season, week, async () => {
    const map: ProjectionMap = new Map();
    const positions = [
      ["QB", 10],
      ["RB", 20],
      ["WR", 30],
      ["TE", 40],
    ] as const;
    await Promise.all(
      positions.map(async ([position, posId]) => {
        try {
          const html = await fetchText(
            `https://www.fftoday.com/rankings/playerwkproj.php?Season=${season}&GameWeek=${week}&PosID=${posId}&LeagueID=1&order_by=FFPts&sort_order=DESC&cur_page=0`,
          );
          for (const row of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
            if (!/smallbody/i.test(row)) continue;
            const rawCells = [
              ...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),
            ];
            if (rawCells.length < 6) continue;
            const playerMatch = row.match(
              /stats\/players\/\d+\/[^"'<>]*["'][^>]*>([\s\S]*?)<\/a>/i,
            );
            const player = playerMatch ? decode(playerMatch[1] ?? "") : "";
            if (!player) continue;
            const cells = rawCells.map((match) => decode(match[1] ?? ""));
            mergeStats(map, player, fftodayStats(position, cells));
          }
        } catch {
          // Source remains optional.
        }
      }),
    );
    return map;
  });
}

function loadNfl(season: number, week: number) {
  return cachedSource("nfl", season, week, async () => {
    const map: ProjectionMap = new Map();
    const positions = [
      ["QB", 1, 42],
      ["RB", 2, 100],
      ["WR", 3, 150],
      ["TE", 4, 60],
    ] as const;
    await Promise.all(
      positions.map(async ([position, posId, count]) => {
        try {
          const html = await fetchText(
            `https://fantasy.nfl.com/research/projections?position=${posId}&count=${count}&sort=projectedPts&statCategory=projectedStats&statSeason=${season}&statType=weekProjectedStats&statWeek=${week}`,
          );
          for (const row of html.match(/<tr\b[^>]*class=["'][^"']*player[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
            const playerMatch = row.match(
              /class=["'][^"']*playerName[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
            );
            const player = playerMatch ? decode(playerMatch[1] ?? "") : "";
            if (!player) continue;
            const stats = [
              ...row.matchAll(
                /<td\b[^>]*class=["'][^"']*\bstat\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi,
              ),
            ].map((match) => toNumber(decode(match[1] ?? "")));
            mergeStats(map, player, {
              passingYards: stats[1] ?? undefined,
              passingTouchdowns: stats[2] ?? undefined,
              rushingYards: stats[4] ?? undefined,
              rushingTouchdowns: stats[5] ?? undefined,
              receptions: stats[6] ?? undefined,
              receivingYards: stats[7] ?? undefined,
              receivingTouchdowns: stats[8] ?? undefined,
            });
          }
        } catch {
          // Source remains optional.
        }
      }),
    );
    return map;
  });
}

function likelyPositions(family: CanonicalMarket["family"]) {
  if (family === "passing_yards" || family === "passing_touchdowns") {
    return ["QB"] as const;
  }
  if (family === "rushing_yards") return ["RB", "QB", "WR"] as const;
  if (
    family === "receiving_yards" ||
    family === "receptions" ||
    family === "touchdowns"
  ) {
    return ["WR", "RB", "TE"] as const;
  }
  return [] as const;
}

async function numberFireMarketProjection(
  market: CanonicalMarket,
): Promise<ProjectionPoint | null> {
  const target = normalizePerson(market.subject);
  const positions = likelyPositions(market.family).map((position) =>
    position.toLowerCase(),
  );

  for (const position of positions) {
    try {
      const rows = rowsFromHtml(
        await fetchText(
          `https://www.numberfire.com/external/widgets/top-players/${position}`,
        ),
      );
      for (const cells of rows) {
        const playerIndex = cells.findIndex((cell) =>
          normalizePerson(cell).startsWith(target),
        );
        if (playerIndex < 0) continue;

        let value: number | null = null;
        if (position === "qb") {
          if (market.family === "passing_yards") {
            value = toNumber(cells[playerIndex + 2]);
          } else if (market.family === "passing_touchdowns") {
            value = toNumber(cells[playerIndex + 3]);
          }
        } else if (position === "wr" || position === "te") {
          if (market.family === "receptions") {
            value = toNumber(cells[playerIndex + 2]);
          } else if (market.family === "receiving_yards") {
            value = toNumber(cells[playerIndex + 3]);
          } else if (market.family === "touchdowns") {
            value = toNumber(cells[playerIndex + 4]);
          }
        } else if (position === "rb" && market.family === "touchdowns") {
          value = toNumber(cells[playerIndex + 3]);
        }
        if (value !== null && value >= 0) {
          return {
            source: "numberfire",
            value,
            fetchedAt: new Date().toISOString(),
          };
        }
      }
    } catch {
      // Try another position/source.
    }
  }
  return null;
}

function fftodayMarketStats(
  position: string,
  cells: string[],
  playerIndex: number,
): ProjectionStats {
  const values = cells.slice(playerIndex + 3).map(toNumber);
  if (position === "QB") {
    return {
      passingYards: values[2] ?? undefined,
      passingTouchdowns: values[3] ?? undefined,
      rushingYards: values[6] ?? undefined,
      rushingTouchdowns: values[7] ?? undefined,
    };
  }
  if (position === "RB") {
    return {
      rushingYards: values[1] ?? undefined,
      rushingTouchdowns: values[2] ?? undefined,
      receptions: values[3] ?? undefined,
      receivingYards: values[4] ?? undefined,
      receivingTouchdowns: values[5] ?? undefined,
    };
  }
  if (position === "WR") {
    return {
      receptions: values[0] ?? undefined,
      receivingYards: values[1] ?? undefined,
      receivingTouchdowns: values[2] ?? undefined,
      rushingYards: values[4] ?? undefined,
      rushingTouchdowns: values[5] ?? undefined,
    };
  }
  return {
    receptions: values[0] ?? undefined,
    receivingYards: values[1] ?? undefined,
    receivingTouchdowns: values[2] ?? undefined,
  };
}

async function ffTodayMarketProjection(
  market: CanonicalMarket,
  season: number,
  week: number,
): Promise<ProjectionPoint | null> {
  const target = normalizePerson(market.subject);
  const posIds: Record<string, number> = { QB: 10, RB: 20, WR: 30, TE: 40 };
  const maxPages: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 1 };

  for (const position of likelyPositions(market.family)) {
    const posId = posIds[position];
    for (let page = 0; page < maxPages[position]; page += 1) {
      try {
        const html = await fetchText(
          `https://www.fftoday.com/rankings/playerwkproj.php?Season=${season}&GameWeek=${week}&PosID=${posId}&LeagueID=1&order_by=FFPts&sort_order=DESC&cur_page=${page}`,
        );
        for (const cells of rowsFromHtml(html)) {
          const playerIndex = cells.findIndex((cell) =>
            normalizePerson(cell).startsWith(target),
          );
          if (playerIndex < 0) continue;
          const value = sourceValue(
            fftodayMarketStats(position, cells, playerIndex),
            market.family,
          );
          if (value !== null && value >= 0) {
            return {
              source: "fftoday",
              value,
              fetchedAt: new Date().toISOString(),
            };
          }
        }
      } catch (error) {
        console.error("FFToday projection fetch failed", position, page, error);
      }
    }
  }
  return null;
}

async function nflMarketProjection(
  market: CanonicalMarket,
  season: number,
  week: number,
): Promise<ProjectionPoint | null> {
  const target = normalizePerson(market.subject);
  const posIds: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 4 };
  const counts: Record<string, number> = { QB: 42, RB: 100, WR: 150, TE: 60 };

  for (const position of likelyPositions(market.family)) {
    try {
      const html = await fetchText(
        `https://fantasy.nfl.com/research/projections?position=${posIds[position]}&count=${counts[position]}&sort=projectedPts&statCategory=projectedStats&statSeason=${season}&statType=weekProjectedStats&statWeek=${week}`,
      );
      for (const row of html.match(/<tr\b[^>]*class=["'][^"']*player[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
        if (!normalizePerson(decode(row)).includes(target)) continue;
        const stats = [
          ...row.matchAll(
            /<td\b[^>]*class=["'][^"']*\bstat\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi,
          ),
        ].map((match) => toNumber(decode(match[1] ?? "")));
        const value = sourceValue(
          {
            passingYards: stats[1] ?? undefined,
            passingTouchdowns: stats[2] ?? undefined,
            rushingYards: stats[4] ?? undefined,
            rushingTouchdowns: stats[5] ?? undefined,
            receptions: stats[6] ?? undefined,
            receivingYards: stats[7] ?? undefined,
            receivingTouchdowns: stats[8] ?? undefined,
          },
          market.family,
        );
        if (value !== null && value >= 0) {
          return {
            source: "nfl",
            value,
            fetchedAt: new Date().toISOString(),
          };
        }
      }
    } catch (error) {
      console.error("NFL.com projection fetch failed", position, error);
    }
  }
  return null;
}

async function sourceProjection(
  source: ProjectionSource,
  market: CanonicalMarket,
  season: number,
  week: number,
): Promise<ProjectionPoint | null> {
  if (source === "numberfire") return numberFireMarketProjection(market);
  if (source === "fftoday") {
    return ffTodayMarketProjection(market, season, week);
  }
  if (source === "nfl") return nflMarketProjection(market, season, week);

  const loader =
    source === "fantasypros"
      ? loadFantasyPros
      : source === "espn"
        ? loadEspn
        : loadCbs;

  const map = await loader(season, week);
  const target = normalizePerson(market.subject);
  const direct = map.get(target);
  const fuzzy =
    direct ??
    [...map.entries()].find(
      ([name]) => name.startsWith(target) || target.startsWith(name),
    )?.[1];
  const value = sourceValue(fuzzy, market.family);
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return {
    source,
    value,
    fetchedAt: new Date().toISOString(),
  };
}

async function buildConsensus(
  market: CanonicalMarket,
  season: number,
  week: number,
) {
  const sources: ProjectionSource[] = [
    "fantasypros",
    "numberfire",
    "espn",
    "cbs",
    "fftoday",
    "nfl",
  ];
  const settled = await Promise.allSettled(
    sources.map((source) => sourceProjection(source, market, season, week)),
  );

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
  season = 2026,
) {
  const resolvedWeek = week ?? 1;
  const key = [
    normalizePerson(market.subject),
    market.family,
    market.statistic ?? "",
    season,
    resolvedWeek,
  ].join(":");

  const cached = consensusCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = buildConsensus(market, season, resolvedWeek);
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
