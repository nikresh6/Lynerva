import "server-only";

import type { CanonicalMarket } from "@/lib/markets/types";
import { getLearnedSourceWeights } from "./source-learning";
import { ACTIVE_PROJECTION_SOURCES } from "./source-weighting";

export type ProjectionSource =
  | "fantasypros"
  | "numberfire"
  | "espn"
  | "cbs"
  | "fftoday"
  | "nfl"
  | "covers"
  | "dimers"
  | "fourforfour";

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
const SOURCE_TIMEOUT_MS = 3_500;

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
      sourceWeights: Record<string, number> | null;
      weightWeek: number | null;
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

  const entry = {
    expiresAt: Date.now() + PAGE_TTL_MS,
    promise: loader(),
  };
  sourceCache.set(key, entry);

  return entry.promise.catch(() => {
    const current = sourceCache.get(key);
    if (current === entry) current.expiresAt = Date.now() + FAILURE_TTL_MS;
    return new Map<string, ProjectionStats>();
  });
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
        const url =
          `https://www.fantasypros.com/nfl/projections/${position}.php?week=${week}`;
        try {
          const rows = rowsFromHtml(await fetchText(url));
          for (const cells of rows) {
            if (cells.length < 3) continue;
            const player = cells[0]?.replace(/\s+[A-Z]{2,3}\s*$/i, "").trim();
            if (!player) continue;
            const stats = fantasyProsStats(position, cells);
            if (Object.values(stats).some((value) => value !== undefined)) {
              mergeStats(map, player, stats);
            }
          }
        } catch {
          // A missing weekly page must stay missing. Never fall back to the
          // season/draft projections, because those values are not comparable
          // to a single-game player prop.
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
          const html = await fetchText(
            `https://www.numberfire.com/external/widgets/top-players/${position}`,
          );
          if (
            !new RegExp(`Top\\s+Fantasy\\s+Players\\s+for\\s+Week\\s+${week}\\b`, "i").test(
              decode(html),
            )
          ) {
            return;
          }
          const rows = rowsFromHtml(html);
          for (const cells of rows) {
            const playerIndex = cells.length >= 4 ? 1 : -1;
            if (playerIndex < 0) continue;
            const player = (cells[playerIndex] ?? "")
              .replace(/\s*\([A-Z]{1,3},\s*[A-Z]{2,4}\)\s*$/i, "")
              .trim();
            if (!player) continue;
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
    const filter = {
      players: {
        filterStatsForSourceIds: { value: [1] },
        filterStatsForSplitTypeIds: { value: [1] },
        sortAppliedStatTotal: {
          sortAsc: false,
          sortPriority: 3,
          value: `11${season}${week}`,
        },
        sortDraftRanks: {
          sortPriority: 2,
          sortAsc: true,
          value: "PPR",
        },
        sortPercOwned: {
          sortAsc: false,
          sortPriority: 4,
        },
        limit: 500,
        offset: 0,
        filterRanksForScoringPeriodIds: { value: [week] },
        filterRanksForRankTypes: { value: ["PPR"] },
        filterRanksForSlotIds: { value: [0, 2, 4, 6, 17, 16, 15] },
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
    const payload = (await fetchJson(
      `espn:${season}:${week}`,
      url,
      {
        Accept: "application/json",
        "User-Agent": "Lynerva/1.0",
        "X-Fantasy-Source": "kona",
        "X-Fantasy-Filter": JSON.stringify(filter),
      },
    )) as {
      players?: Array<{
        id?: number;
        player?: {
          fullName?: string;
          stats?: Array<{
            statSourceId?: number;
            statSplitTypeId?: number;
            scoringPeriodId?: number;
            stats?: Record<string, number>;
          }>;
        };
      }>;
    };

    for (const entry of payload.players ?? []) {
      const player = entry.player;
      if (!player?.fullName) continue;
      const projection = player.stats?.find(
        (stat) =>
          stat.statSourceId === 1 &&
          stat.statSplitTypeId === 1 &&
          stat.scoringPeriodId === week,
      );
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
    return map;
  });
}

function cbsStats(position: string, cells: string[]): ProjectionStats {
  // CBS uses stable, position-specific projection tables. Cell 0 is the player.
  if (position === "QB") {
    return {
      passingYards: toNumber(cells[4]) ?? undefined,
      passingTouchdowns: toNumber(cells[6]) ?? undefined,
      rushingYards: toNumber(cells[10]) ?? undefined,
      rushingTouchdowns: toNumber(cells[12]) ?? undefined,
    };
  }

  if (position === "RB") {
    return {
      rushingYards: toNumber(cells[3]) ?? undefined,
      rushingTouchdowns: toNumber(cells[5]) ?? undefined,
      receptions: toNumber(cells[7]) ?? undefined,
      receivingYards: toNumber(cells[8]) ?? undefined,
      receivingTouchdowns: toNumber(cells[11]) ?? undefined,
    };
  }

  if (position === "WR") {
    return {
      receptions: toNumber(cells[3]) ?? undefined,
      receivingYards: toNumber(cells[4]) ?? undefined,
      receivingTouchdowns: toNumber(cells[7]) ?? undefined,
      rushingYards: toNumber(cells[9]) ?? undefined,
      rushingTouchdowns: toNumber(cells[11]) ?? undefined,
    };
  }

  return {
    receptions: toNumber(cells[3]) ?? undefined,
    receivingYards: toNumber(cells[4]) ?? undefined,
    receivingTouchdowns: toNumber(cells[7]) ?? undefined,
  };
}

function loadCbs(season: number, week: number) {
  return cachedSource("cbs", season, week, async () => {
    const map: ProjectionMap = new Map();
    await Promise.all(
      ["QB", "RB", "WR", "TE"].map(async (position) => {
        try {
          const html = await fetchText(
            `https://www.cbssports.com/fantasy/football/stats/${position}/${season}/${week}/projections/nonppr/`,
          );
          for (const row of html.match(/<tr\b[^>]*TableBase-bodyTr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
            const nameMatch = row.match(
              /CellPlayerName--long[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i,
            );
            const player = nameMatch ? decode(nameMatch[1] ?? "") : "";
            if (!player) continue;
            const cells = [
              ...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),
            ].map((match) => decode(match[1] ?? ""));
            mergeStats(map, player, cbsStats(position, cells));
          }
        } catch {
          // Source remains optional.
        }
      }),
    );
    return map;
  });
}

function ffTodayRowStats(
  position: string,
  cells: string[],
  playerIndex: number,
): ProjectionStats {
  // FFToday weekly tables place Team and Opp immediately after Player.
  // Skill positions then use: RuAtt, RuYd, RuTD, Rec, RecYd, RecTD.
  // QB uses: Comp, Att, PaYd, PaTD, INT, RuAtt, RuYd, RuTD.
  if (position === "QB") {
    return {
      passingYards: toNumber(cells[playerIndex + 5]) ?? undefined,
      passingTouchdowns: toNumber(cells[playerIndex + 6]) ?? undefined,
      rushingYards: toNumber(cells[playerIndex + 9]) ?? undefined,
      rushingTouchdowns: toNumber(cells[playerIndex + 10]) ?? undefined,
    };
  }

  return {
    rushingYards: toNumber(cells[playerIndex + 4]) ?? undefined,
    rushingTouchdowns: toNumber(cells[playerIndex + 5]) ?? undefined,
    receptions: toNumber(cells[playerIndex + 6]) ?? undefined,
    receivingYards: toNumber(cells[playerIndex + 7]) ?? undefined,
    receivingTouchdowns: toNumber(cells[playerIndex + 8]) ?? undefined,
  };
}

function loadFfToday(season: number, week: number) {
  return cachedSource("fftoday", season, week, async () => {
    const map: ProjectionMap = new Map();
    const positions = [
      ["QB", 10, 2],
      ["RB", 20, 4],
      ["WR", 30, 5],
      ["TE", 40, 3],
    ] as const;

    await Promise.all(
      positions.flatMap(([position, posId, pageCount]) =>
        Array.from({ length: pageCount }, (_, page) =>
          (async () => {
            try {
              const html = await fetchText(
                `https://www.fftoday.com/rankings/playerwkproj.php?Season=${season}&GameWeek=${week}&PosID=${posId}&LeagueID=1&order_by=FFPts&sort_order=DESC&cur_page=${page}`,
              );
              if (
                !new RegExp(`${season}\\s+Week\\s+${week}`, "i").test(
                  decode(html),
                )
              ) {
                return;
              }

              for (const row of html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
                const rawCells = [
                  ...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),
                ];
                if (!rawCells.length) continue;

                const playerIndex = rawCells.findIndex((match) =>
                  /stats\/players\/\d+/i.test(match[1] ?? ""),
                );
                if (playerIndex < 0) continue;

                const playerMatch = (rawCells[playerIndex]?.[1] ?? "").match(
                  /<a[^>]*>([\s\S]*?)<\/a>/i,
                );
                const player = playerMatch ? decode(playerMatch[1] ?? "") : "";
                if (!player) continue;

                const cells = rawCells.map((match) => decode(match[1] ?? ""));
                const stats = ffTodayRowStats(position, cells, playerIndex);
                if (Object.values(stats).some((value) => value !== undefined)) {
                  mergeStats(map, player, stats);
                }
              }
            } catch {
              // Weekly source is optional. A failed page is retried after the
              // short failure TTL rather than replaced with non-weekly data.
            }
          })(),
        ),
      ),
    );

    return map;
  });
}

function loadFourForFour(season: number, week: number) {
  return cachedSource("fourforfour", season, week, async () => {
    const map: ProjectionMap = new Map();
    const html = await fetchText(
      `https://www.4for4.com/fantasy-football-projections/standard/sflex/${season}/week${week}`,
    );
    const pageText = decode(html);
    if (
      !new RegExp(`${season}\\s+NFL\\s+Week\\s+${week}`, "i").test(
        pageText,
      )
    ) {
      return map;
    }

    for (const cells of rowsFromHtml(html)) {
      // Unified Superflex table:
      // #, Player, Pos, Team, Opp, M/U, FF Pts, PaYds, PaTD, INT, Pa1D,
      // RuYds, RuTD, Ru1D, Rec, RecYds, RecTD, Rec1D.
      if (cells.length < 17) continue;
      const player = cells[1]?.trim();
      const position = cells[2]?.trim().toUpperCase();
      if (!player || !["QB", "RB", "WR", "TE"].includes(position ?? "")) {
        continue;
      }

      mergeStats(map, player, {
        passingYards: toNumber(cells[7]) ?? undefined,
        passingTouchdowns: toNumber(cells[8]) ?? undefined,
        rushingYards: toNumber(cells[11]) ?? undefined,
        rushingTouchdowns: toNumber(cells[12]) ?? undefined,
        receptions: toNumber(cells[14]) ?? undefined,
        receivingYards: toNumber(cells[15]) ?? undefined,
        receivingTouchdowns: toNumber(cells[16]) ?? undefined,
      });
    }

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

function abbreviatedName(name: string) {
  const clean = name.replace(/[’']/g, "'").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return clean;
  return `${parts[0]?.[0] ?? ""}. ${parts.at(-1) ?? ""}`;
}

function namesMatch(candidate: string, target: string) {
  const left = normalizePerson(candidate).split(" ").filter(Boolean);
  const right = normalizePerson(target).split(" ").filter(Boolean);
  if (!left.length || !right.length) return false;
  const leftFull = left.join(" ");
  const rightFull = right.join(" ");
  if (leftFull === rightFull) return true;

  // Only allow a first-initial + last-name abbreviation, e.g. "B Robinson"
  // matching "Brian Robinson". Never use broad prefix matching, because
  // "Brian Robinson" and "Bijan Robinson" share enough characters to collide.
  const abbreviated = (shorter: string[], longer: string[]) =>
    shorter.length === 2 &&
    longer.length >= 2 &&
    shorter[0]?.length === 1 &&
    shorter[0] === longer[0]?.[0] &&
    shorter.at(-1) === longer.at(-1);

  return abbreviated(left, right) || abbreviated(right, left);
}

function loadCovers(season: number, week: number) {
  return cachedSource("covers", season, week, async () => {
    const map: ProjectionMap = new Map();
    const text = decode(
      await fetchText(
        "https://www.covers.com/sport/football/nfl/player-props",
      ),
    );

    const pattern =
      /([A-Z]\.\s+[A-Za-z'’.-]+(?:\s+(?:Jr\.?|Sr\.?|II|III|IV))?)\s+\((?:QB|RB|WR|TE)\)\s+[ou]\d+(?:\.\d+)?\s+(Passing Yards|Rushing Yards|Receiving Yards|Receptions)\s+(-?\d+(?:\.\d+)?)\s+(?:OVER|UNDER)\s+PROJECTION/gi;

    for (const match of text.matchAll(pattern)) {
      const player = match[1] ?? "";
      const family = (match[2] ?? "").toUpperCase();
      const value = Number(match[3]);
      if (!player || !Number.isFinite(value) || value < 0) continue;

      if (family === "PASSING YARDS") {
        mergeStats(map, player, { passingYards: value });
      } else if (family === "RUSHING YARDS") {
        mergeStats(map, player, { rushingYards: value });
      } else if (family === "RECEIVING YARDS") {
        mergeStats(map, player, { receivingYards: value });
      } else if (family === "RECEPTIONS") {
        mergeStats(map, player, { receptions: value });
      }
    }

    return map;
  });
}

function loadDimers(season: number, week: number) {
  return cachedSource("dimers", season, week, async () => {
    const map: ProjectionMap = new Map();
    const rows = rowsFromHtml(
      await fetchText("https://www.dimers.com/nfl/player-projections"),
    );

    for (const cells of rows) {
      if (cells.length < 11) continue;
      const player = cells[0] ?? "";
      if (!player || /^player$/i.test(player)) continue;

      const touchdownChance = toNumber(cells[11]);
      mergeStats(map, player, {
        passingYards: toNumber(cells[7]) ?? undefined,
        rushingYards: toNumber(cells[8]) ?? undefined,
        receptions: toNumber(cells[9]) ?? undefined,
        receivingYards: toNumber(cells[10]) ?? undefined,
        receivingTouchdowns:
          touchdownChance !== null &&
          touchdownChance > 0 &&
          touchdownChance < 100
            ? -Math.log(1 - touchdownChance / 100)
            : undefined,
      });
    }

    return map;
  });
}

export function resolveProjectionPlayer<T>(
  entries: Array<[string, T]>,
  subject: string,
) {
  const target = normalizePerson(subject);
  const exact = entries.find(([name]) => normalizePerson(name) === target);
  if (exact) return exact[1];

  const matches = entries.filter(([name]) => namesMatch(name, subject));
  return matches.length === 1 ? matches[0]?.[1] ?? null : null;
}

async function sourceProjection(
  source: ProjectionSource,
  market: CanonicalMarket,
  season: number,
  week: number,
): Promise<ProjectionPoint | null> {
  if (source === "nfl") return nflMarketProjection(market, season, week);

  const loader =
    source === "fantasypros"
      ? loadFantasyPros
      : source === "numberfire"
        ? loadNumberFire
        : source === "espn"
          ? loadEspn
          : source === "cbs"
            ? loadCbs
            : source === "fftoday"
              ? loadFfToday
              : source === "covers"
                ? loadCovers
                : source === "fourforfour"
                  ? loadFourForFour
                  : loadDimers;

  const map = await loader(season, week);
  // Prefer an exact normalized player name. Abbreviated fallbacks are used
  // only when they identify exactly one player, so B. Robinson can never
  // silently map Brian Robinson Jr. to Bijan Robinson.
  const found = resolveProjectionPlayer([...map.entries()], market.subject);
  const value = sourceValue(found ?? undefined, market.family);
  if (value === null || !Number.isFinite(value) || value < 0) return null;

  return {
    source,
    value,
    fetchedAt: new Date().toISOString(),
  };
}

function plausibleProjection(
  family: CanonicalMarket["family"],
  value: number,
) {
  if (!Number.isFinite(value) || value < 0) return false;
  if (family === "passing_yards") return value <= 600;
  if (family === "passing_touchdowns") return value <= 6;
  if (family === "rushing_yards") return value <= 300;
  if (family === "receiving_yards") return value <= 300;
  if (family === "receptions") return value <= 20;
  if (family === "touchdowns") return value <= 3;
  return true;
}

function robustProjectionPoints(
  family: CanonicalMarket["family"],
  points: ProjectionPoint[],
) {
  const plausible = points.filter((point) =>
    plausibleProjection(family, point.value),
  );
  if (plausible.length < 3) return plausible;

  const sorted = plausible.map((point) => point.value).toSorted((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median <= 0) return plausible;

  // A parser/name failure can still produce a numerically plausible value.
  // Reject a lone source that is wildly separated from a multi-source cluster.
  return plausible.filter((point) => {
    const ratio = point.value / median;
    return ratio >= 0.45 && ratio <= 2.2;
  });
}

async function buildConsensus(
  market: CanonicalMarket,
  season: number,
  week: number,
) {
  const sources: readonly ProjectionSource[] = ACTIVE_PROJECTION_SOURCES;
  const [settled, learned] = await Promise.all([
    Promise.allSettled(
      sources.map((source) => sourceProjection(source, market, season, week)),
    ),
    getLearnedSourceWeights(market.family, season, week),
  ]);

  const uniquePoints = settled
    .flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    )
    .filter(
      (point, index, all) =>
        all.findIndex((candidate) => candidate.source === point.source) ===
        index,
    );
  const points = robustProjectionPoints(market.family, uniquePoints);

  if (!points.length) {
    return {
      projection: null,
      points: [] as ProjectionPoint[],
      dispersion: null,
      sourceWeights: learned?.weights ?? null,
      weightWeek: learned?.effectiveWeek ?? null,
    };
  }

  const availableWeights = points.map((point) => ({
    point,
    weight: learned?.weights[point.source] ?? 1,
  }));
  const weightTotal =
    availableWeights.reduce((sum, item) => sum + item.weight, 0) || 1;
  const projection = availableWeights.reduce(
    (sum, item) => sum + item.point.value * (item.weight / weightTotal),
    0,
  );
  const variance = availableWeights.reduce(
    (sum, item) =>
      sum +
      (item.weight / weightTotal) *
        (item.point.value - projection) ** 2,
    0,
  );

  return {
    projection,
    points,
    dispersion: points.length > 1 ? Math.sqrt(variance) : null,
    sourceWeights: learned?.weights ?? null,
    weightWeek: learned?.effectiveWeek ?? null,
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
