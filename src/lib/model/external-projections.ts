import "server-only";

/* eslint-disable @typescript-eslint/no-unused-vars -- dormant provider adapters are intentionally retained for rapid source failover */

import type { CanonicalMarket } from "@/lib/markets/types";
import { getLearnedSourceWeights } from "./source-learning";
import {
  ACTIVE_PROJECTION_SOURCES,
  type ActiveProjectionSource,
} from "./source-weighting";

export type ProjectionSource =
  | "fantasypros"
  | "numberfire"
  | "espn"
  | "cbs"
  | "fftoday"
  | "nfl"
  | "covers"
  | "dimers"
  | "fourforfour"
  | "rotoballer"
  | "sleeper";

export interface ProjectionPoint {
  source: ProjectionSource;
  value: number;
  fetchedAt: string;
  position?: "QB" | "RB" | "WR" | "TE";
  firstObservedAt?: string;
  lastChangedAt?: string | null;
}

interface ProjectionStats {
  position?: "QB" | "RB" | "WR" | "TE";
  passingYards?: number;
  passingTouchdowns?: number;
  passingInterceptions?: number;
  rushingYards?: number;
  rushingTouchdowns?: number;
  receptions?: number;
  receivingYards?: number;
  receivingTouchdowns?: number;
  totalTouchdowns?: number;
}

type ProjectionMap = Map<string, ProjectionStats>;

const PAGE_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 30_000;
const CONSENSUS_TTL_MS = 5 * 60_000;
// Public projection pages are fetched in parallel, so a slightly more patient
// timeout materially improves coverage without adding the timeouts together.
// The old 2.2-second cutoff intermittently erased otherwise valid ESPN and
// FantasyPros rows on Railway.
const SOURCE_TIMEOUT_MS = 6_000;
const SOURCE_LAST_GOOD_TTL_MS = 6 * 60 * 60_000;

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
const lastGoodSourceCache = new Map<
  string,
  { storedAt: number; map: ProjectionMap }
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
      position: "QB" | "RB" | "WR" | "TE" | null;
    }>;
  }
>();

const projectionObservationCache = new Map<
  string,
  {
    firstObservedAt: string;
    lastChangedAt: string | null;
    value: number;
  }
>();

function observeProjectionPoint(input: {
  source: ProjectionSource;
  subject: string;
  family: CanonicalMarket["family"];
  season: number;
  week: number;
  value: number;
  position?: "QB" | "RB" | "WR" | "TE";
}): ProjectionPoint {
  const now = new Date().toISOString();
  const key = [
    input.source,
    normalizePerson(input.subject),
    input.family,
    input.season,
    input.week,
  ].join(":");
  const previous = projectionObservationCache.get(key);
  const changed =
    previous &&
    Math.abs(previous.value - input.value) >=
      Math.max(0.1, Math.abs(previous.value) * 0.01);

  const observation = previous
    ? {
        firstObservedAt: previous.firstObservedAt,
        lastChangedAt: changed ? now : previous.lastChangedAt,
        value: input.value,
      }
    : {
        firstObservedAt: now,
        lastChangedAt: null,
        value: input.value,
      };
  projectionObservationCache.set(key, observation);

  return {
    source: input.source,
    value: input.value,
    fetchedAt: now,
    position: input.position,
    firstObservedAt: observation.firstObservedAt,
    lastChangedAt: observation.lastChangedAt,
  };
}

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
  if (family === "passing_interceptions") return stats.passingInterceptions ?? null;
  if (family === "rushing_yards") return stats.rushingYards ?? null;
  if (family === "rushing_touchdowns") return stats.rushingTouchdowns ?? null;
  if (family === "receptions") return stats.receptions ?? null;
  if (family === "receiving_yards") return stats.receivingYards ?? null;
  if (family === "receiving_touchdowns") return stats.receivingTouchdowns ?? null;
  if (family === "touchdowns") {
    if (stats.totalTouchdowns !== undefined) return stats.totalTouchdowns;
    const rushing = stats.rushingTouchdowns ?? 0;
    const receiving = stats.receivingTouchdowns ?? 0;
    const total = rushing + receiving;
    return total > 0 ? total : null;
  }
  return null;
}

function cachedSource(
  source: string,
  season: number,
  week: number,
  loader: () => Promise<ProjectionMap>,
) {
  const key = `${source}:${season}:${week}`;
  const cached = sourceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const load = async () => {
    const previous = lastGoodSourceCache.get(key);
    try {
      const next = await loader();

      // Projection sites occasionally return an incomplete/empty response
      // during a transient refresh. Do not let one bad fetch remove a large
      // chunk of the source set and jerk consensus probabilities around.
      if (
        previous &&
        Date.now() - previous.storedAt <= SOURCE_LAST_GOOD_TTL_MS &&
        (next.size === 0 ||
          (previous.map.size >= 20 && next.size < previous.map.size * 0.6))
      ) {
        return previous.map;
      }

      if (next.size > 0) {
        lastGoodSourceCache.set(key, {
          storedAt: Date.now(),
          map: next,
        });
      }
      return next;
    } catch {
      if (
        previous &&
        Date.now() - previous.storedAt <= SOURCE_LAST_GOOD_TTL_MS
      ) {
        return previous.map;
      }
      throw new Error(`Projection source ${source} unavailable`);
    }
  };

  const entry = {
    expiresAt: Date.now() + PAGE_TTL_MS,
    promise: load(),
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
      position: "QB",
      passingYards: values[2] ?? undefined,
      passingTouchdowns: values[3] ?? undefined,
      passingInterceptions: values[4] ?? undefined,
      rushingYards: values[6] ?? undefined,
      rushingTouchdowns: values[7] ?? undefined,
    };
  }
  if (position === "rb") {
    return {
      position: "RB",
      rushingYards: values[1] ?? undefined,
      rushingTouchdowns: values[2] ?? undefined,
      receptions: values[3] ?? undefined,
      receivingYards: values[4] ?? undefined,
      receivingTouchdowns: values[5] ?? undefined,
    };
  }
  return {
    position: position.toUpperCase() as "WR" | "TE",
    receptions: values[0] ?? undefined,
    receivingYards: values[1] ?? undefined,
    receivingTouchdowns: values[2] ?? undefined,
    rushingYards: values[4] ?? undefined,
    rushingTouchdowns: values[5] ?? undefined,
  };
}

function fantasyProsPlayerSlug(subject: string) {
  return normalizePerson(subject).replace(/\s+/g, "-");
}

function fantasyProsIndividualStats(html: string, week: number) {
  const pageText = decode(html);
  if (!new RegExp(`Projections\\s*\\(Week\\s+${week}\\)`, "i").test(pageText)) {
    return null;
  }

  const rows = rowsFromHtml(html);
  for (let index = 0; index < rows.length - 1; index += 1) {
    const headers = rows[index]?.map((cell) =>
      cell.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    );
    const values = rows[index + 1];
    if (!headers?.length || !values || headers.length !== values.length) continue;
    if (!headers.some((header) => header === "rush yds" || header === "rec yds" || header === "pass yds")) {
      continue;
    }

    const valueFor = (...labels: string[]) => {
      const column = headers.findIndex((header) => labels.includes(header));
      return column < 0 ? undefined : toNumber(values[column]) ?? undefined;
    };
    const stats: ProjectionStats = {
      passingYards: valueFor("pass yds", "passing yds"),
      passingTouchdowns: valueFor("pass tds", "passing tds"),
      passingInterceptions: valueFor("ints", "interceptions"),
      rushingYards: valueFor("rush yds", "rushing yds"),
      rushingTouchdowns: valueFor("rush tds", "rushing tds"),
      receptions: valueFor("recs", "receptions"),
      receivingYards: valueFor("rec yds", "receiving yds"),
      receivingTouchdowns: valueFor("rec tds", "receiving tds"),
    };
    if (Object.values(stats).some((value) => value !== undefined)) return stats;
  }

  return null;
}

async function fantasyProsMarketStats(
  market: CanonicalMarket,
  week: number,
) {
  const slug = fantasyProsPlayerSlug(market.subject);
  if (!slug) return null;
  try {
    const html = await fetchText(
      `https://www.fantasypros.com/nfl/projections/${slug}.php?week=${week}`,
    );
    return fantasyProsIndividualStats(html, week);
  } catch {
    return null;
  }
}

function loadFantasyPros(season: number, week: number) {
  return cachedSource("fantasypros", season, week, async () => {
    const map: ProjectionMap = new Map();
    await Promise.all(
      ["qb", "rb", "wr", "te"].map(async (position) => {
        const url =
          `https://www.fantasypros.com/nfl/projections/${position}.php?week=${week}`;
        try {
          const html = await fetchText(url);
          if (
            !new RegExp(
              `Fantasy\\s+Football\\s+Projections\\s*-?\\s*Week\\s+${week}\\b`,
              "i",
            ).test(decode(html))
          ) {
            return;
          }
          const rows = rowsFromHtml(html);
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
                position: "QB",
                passingYards: toNumber(cells[playerIndex + 2]) ?? undefined,
                passingTouchdowns: toNumber(cells[playerIndex + 3]) ?? undefined,
              });
            } else if (position === "wr" || position === "te") {
              mergeStats(map, player, {
                position: position.toUpperCase() as "WR" | "TE",
                receptions: toNumber(cells[playerIndex + 2]) ?? undefined,
                receivingYards: toNumber(cells[playerIndex + 3]) ?? undefined,
                totalTouchdowns: toNumber(cells[playerIndex + 4]) ?? undefined,
              });
            } else {
              mergeStats(map, player, {
                position: "RB",
                totalTouchdowns: toNumber(cells[playerIndex + 3]) ?? undefined,
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
          defaultPositionId?: number;
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
      const espnPosition = ({
        1: "QB",
        2: "RB",
        3: "WR",
        4: "TE",
      } as const)[player.defaultPositionId as 1 | 2 | 3 | 4];
      mergeStats(map, player.fullName, {
        position: espnPosition,
        passingYards: toNumber(stats["3"]) ?? undefined,
        passingTouchdowns: toNumber(stats["4"]) ?? undefined,
        passingInterceptions: toNumber(stats["20"]) ?? undefined,
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
      position: "QB",
      passingYards: toNumber(cells[4]) ?? undefined,
      passingTouchdowns: toNumber(cells[6]) ?? undefined,
      passingInterceptions: toNumber(cells[7]) ?? undefined,
      rushingYards: toNumber(cells[10]) ?? undefined,
      rushingTouchdowns: toNumber(cells[12]) ?? undefined,
    };
  }

  if (position === "RB") {
    return {
      position: "RB",
      rushingYards: toNumber(cells[3]) ?? undefined,
      rushingTouchdowns: toNumber(cells[5]) ?? undefined,
      receptions: toNumber(cells[7]) ?? undefined,
      receivingYards: toNumber(cells[8]) ?? undefined,
      receivingTouchdowns: toNumber(cells[11]) ?? undefined,
    };
  }

  if (position === "WR") {
    return {
      position: "WR",
      receptions: toNumber(cells[3]) ?? undefined,
      receivingYards: toNumber(cells[4]) ?? undefined,
      receivingTouchdowns: toNumber(cells[7]) ?? undefined,
      rushingYards: toNumber(cells[9]) ?? undefined,
      rushingTouchdowns: toNumber(cells[11]) ?? undefined,
    };
  }

  return {
    position: "TE",
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
          if (
            !new RegExp(`Week\\s+${week}\\s+Proj\\s+Fantasy\\s+Football`, "i").test(
              decode(html),
            )
          ) {
            return;
          }
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
): ProjectionStats {
  const numeric = cells
    .map(toNumber)
    .filter((value): value is number => value !== null);

  if (position === "QB") {
    // FFToday QB rows end with:
    // Cmp, Att, PassYds, PassTD, INT, RushAtt, RushYds, RushTD, FPts.
    const values = numeric.slice(-9);
    if (values.length < 9) return {};
    return {
      passingYards: values[2],
      passingTouchdowns: values[3],
      passingInterceptions: values[4],
      rushingYards: values[6],
      rushingTouchdowns: values[7],
    };
  }

  // RB/WR/TE rows end with:
  // RushAtt, RushYds, RushTD, Rec, RecYds, RecTD, FPts.
  const values = numeric.slice(-7);
  if (values.length < 7) return {};
  return {
    rushingYards: values[1],
    rushingTouchdowns: values[2],
    receptions: values[3],
    receivingYards: values[4],
    receivingTouchdowns: values[5],
  };
}

function ffTodayPlayerFromRow(cells: string[]) {
  const teams =
    "(?:ARI|ATL|BAL|BUF|CAR|CHI|CIN|CLE|DAL|DEN|DET|GB|HOU|IND|JAX|KC|LV|LAC|LAR|MIA|MIN|NE|NO|NYG|NYJ|PHI|PIT|SF|SEA|TB|TEN|WAS)";

  // Some FFToday responses put the team in its own cell.
  for (let index = 0; index < cells.length - 1; index += 1) {
    if (!new RegExp(`^${teams}$`, "i").test(cells[index + 1]?.trim() ?? "")) {
      continue;
    }
    const candidate = (cells[index] ?? "")
      .replace(/\s+(?:Risk|Upside):.*$/i, "")
      .trim();
    if (/^[A-Za-z][A-Za-z.'’ -]+\s+[A-Za-z][A-Za-z.'’ -]+$/.test(candidate)) {
      return candidate;
    }
  }

  // Other responses append the team code to the player cell.
  const merged = cells
    .map((cell) => cell.trim())
    .map((cell) => {
      const match = cell.match(
        new RegExp(`^(.+?)\\s+${teams}$`, "i"),
      );
      return match?.[1]
        ?.replace(/\s+(?:Risk|Upside):.*$/i, "")
        .trim();
    })
    .find((candidate) =>
      Boolean(
        candidate &&
          /^[A-Za-z][A-Za-z.'’ -]+\s+[A-Za-z][A-Za-z.'’ -]+$/.test(
            candidate,
          ),
      ),
    );

  return merged ?? null;
}

function loadFfToday(season: number, week: number) {
  return cachedSource("fftoday", season, week, async () => {
    const map: ProjectionMap = new Map();
    const positions = [
      ["QB", 10, 1],
      ["RB", 20, 1],
      ["WR", 30, 1],
      ["TE", 40, 1],
    ] as const;

    await Promise.all(
      positions.flatMap(([position, posId, pageCount]) =>
        Array.from({ length: pageCount }, (_, page) =>
          (async () => {
            try {
              const html = await fetchText(
                `https://www.fftoday.com/rankings/playerwkproj.php?GameWeek=${week}&LeagueID=&PosID=${posId}&Season=${season}&order_by=FFPts&sort_order=DESC&cur_page=${page}`,
              );
              if (
                !new RegExp(`${season}\\s+Week\\s+${week}`, "i").test(
                  decode(html),
                )
              ) {
                return;
              }

              const text = decode(html);
              const team =
                "(?:ARI|ATL|BAL|BUF|CAR|CHI|CIN|CLE|DAL|DEN|DET|GB|HOU|IND|JAX|KC|LV|LAC|LAR|MIA|MIN|NE|NO|NYG|NYJ|PHI|PIT|SF|SEA|TB|TEN|WAS)";
              const name =
                "([A-Z][A-Za-z'’.-]+(?:\\s+[A-Z][A-Za-z'’.-]+){1,3}(?:\\s+(?:Jr\\.?|Sr\\.?|II|III|IV))?)";
              const note =
                "(?:\\s+(?:Image:\\s*)?(?:Risk|Upside):[^0-9]{0,180})?";

              if (position === "QB") {
                const pattern = new RegExp(
                  name +
                    note +
                    "\\s+" +
                    team +
                    "\\s+@?" +
                    team +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)",
                  "g",
                );
                for (const match of text.matchAll(pattern)) {
                  mergeStats(map, match[1] ?? "", {
                    passingYards: toNumber(match[4]) ?? undefined,
                    passingTouchdowns: toNumber(match[5]) ?? undefined,
                    passingInterceptions: toNumber(match[6]) ?? undefined,
                    rushingYards: toNumber(match[8]) ?? undefined,
                    rushingTouchdowns: toNumber(match[9]) ?? undefined,
                  });
                }
              } else {
                const pattern = new RegExp(
                  name +
                    note +
                    "\\s+" +
                    team +
                    "\\s+@?" +
                    team +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)" +
                    "\\s+(-?\\d+(?:\\.\\d+)?)",
                  "g",
                );
                for (const match of text.matchAll(pattern)) {
                  mergeStats(map, match[1] ?? "", {
                    rushingYards: toNumber(match[3]) ?? undefined,
                    rushingTouchdowns: toNumber(match[4]) ?? undefined,
                    receptions: toNumber(match[5]) ?? undefined,
                    receivingYards: toNumber(match[6]) ?? undefined,
                    receivingTouchdowns: toNumber(match[7]) ?? undefined,
                  });
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

function loadRotoBaller(season: number, week: number) {
  return cachedSource("rotoballer", season, week, async () => {
    const map: ProjectionMap = new Map();
    const categoryUrl =
      "https://www.rotoballer.com/category/nfl/fantasy-football-advice-analysis/fantasy-football-projections-articles-analysis";
    const categoryHtml = await fetchText(categoryUrl);

    const hrefs = [
      ...categoryHtml.matchAll(/href=["'](https:\/\/www\.rotoballer\.com\/[^"'<>]+)["']/gi),
    ]
      .map((match) => decode(match[1] ?? ""))
      .filter((href) => {
        const normalized = href.toLowerCase();
        return (
          normalized.includes(`week-${week}`) &&
          normalized.includes(String(season)) &&
          normalized.includes("fantasy-football-projections")
        );
      });

    const articleUrl =
      hrefs.find((href) =>
        href.toLowerCase().includes(
          `fantasy-football-projections-for-week-${week}`,
        ),
      ) ??
      hrefs.find((href) =>
        href.toLowerCase().includes(
          `updated-fantasy-football-projections-for-week-${week}`,
        ),
      ) ??
      hrefs[0];

    if (!articleUrl) return map;

    const html = await fetchText(articleUrl);
    const pageText = decode(html);
    if (
      !new RegExp(`Week\\s+${week}\\s+Fantasy\\s+Football\\s+Projections`, "i").test(
        pageText,
      ) ||
      !pageText.includes(String(season))
    ) {
      return map;
    }

    for (const cells of rowsFromHtml(html)) {
      // Player, Team, Pos, Fan Points, Pass Yards, Pass TDs, INTs,
      // Rush, Rush Yards, Rush TDs, Rec, Rec Yards, Rec TDs.
      if (cells.length < 13) continue;
      const player = cells[0]?.trim();
      const position = cells[2]?.trim().toUpperCase();
      if (!player || !["QB", "RB", "WR", "TE"].includes(position ?? "")) {
        continue;
      }

      mergeStats(map, player, {
        position: position as "QB" | "RB" | "WR" | "TE",
        passingYards: toNumber(cells[4]) ?? undefined,
        passingTouchdowns: toNumber(cells[5]) ?? undefined,
        passingInterceptions: toNumber(cells[6]) ?? undefined,
        rushingYards: toNumber(cells[8]) ?? undefined,
        rushingTouchdowns: toNumber(cells[9]) ?? undefined,
        receptions: toNumber(cells[10]) ?? undefined,
        receivingYards: toNumber(cells[11]) ?? undefined,
        receivingTouchdowns: toNumber(cells[12]) ?? undefined,
      });
    }

    return map;
  });
}

function loadSleeper(season: number, week: number) {
  return cachedSource("sleeper", season, week, async () => {
    const map: ProjectionMap = new Map();

    await Promise.all(
      ["QB", "RB", "WR", "TE"].map(async (position) => {
        try {
          const payload = (await fetchJson(
            `sleeper:${season}:${week}:${position}`,
            `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&position=${position}&order_by=pts_ppr`,
            {
              Accept: "application/json",
              "User-Agent": "Lynerva/1.0",
            },
          )) as Array<{
            player_id?: string;
            week?: number;
            season?: string | number;
            season_type?: string;
            category?: string;
            game_id?: string | null;
            stats?: Record<string, number>;
            player?: {
              first_name?: string | null;
              last_name?: string | null;
              position?: string | null;
            } | null;
          }>;

          if (!Array.isArray(payload)) return;

          for (const row of payload) {
            if (
              row.week !== week ||
              String(row.season ?? "") !== String(season) ||
              row.season_type !== "regular" ||
              row.category !== "proj" ||
              !row.game_id ||
              !row.stats ||
              typeof row.stats.pts_ppr !== "number"
            ) {
              continue;
            }

            const first = row.player?.first_name?.trim() ?? "";
            const last = row.player?.last_name?.trim() ?? "";
            const player = `${first} ${last}`.trim();
            if (!player) continue;

            mergeStats(map, player, {
              position: (row.player?.position?.toUpperCase() ?? position) as
                | "QB"
                | "RB"
                | "WR"
                | "TE",
              passingYards: toNumber(row.stats.pass_yd) ?? undefined,
              passingTouchdowns: toNumber(row.stats.pass_td) ?? undefined,
              passingInterceptions: toNumber(row.stats.pass_int) ?? undefined,
              rushingYards: toNumber(row.stats.rush_yd) ?? undefined,
              rushingTouchdowns: toNumber(row.stats.rush_td) ?? undefined,
              receptions: toNumber(row.stats.rec) ?? undefined,
              receivingYards: toNumber(row.stats.rec_yd) ?? undefined,
              receivingTouchdowns: toNumber(row.stats.rec_td) ?? undefined,
            });
          }
        } catch {
          // Sleeper's projections endpoint is public but undocumented.
          // Treat a failed batch as missing data and retry after the failure TTL.
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
  if (
    family === "passing_yards" ||
    family === "passing_touchdowns" ||
    family === "passing_interceptions"
  ) {
    return ["QB"] as const;
  }
  if (
    family === "rushing_yards" ||
    family === "rushing_touchdowns"
  ) {
    return ["RB", "QB", "WR"] as const;
  }
  if (
    family === "receiving_yards" ||
    family === "receiving_touchdowns" ||
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
  const teamSlugs: Record<string, string> = {
    ARI: "arizona-cardinals", ATL: "atlanta-falcons", BAL: "baltimore-ravens",
    BUF: "buffalo-bills", CAR: "carolina-panthers", CHI: "chicago-bears",
    CIN: "cincinnati-bengals", CLE: "cleveland-browns", DAL: "dallas-cowboys",
    DEN: "denver-broncos", DET: "detroit-lions", GB: "green-bay-packers",
    HOU: "houston-texans", IND: "indianapolis-colts", JAX: "jacksonville-jaguars",
    KC: "kansas-city-chiefs", LAC: "los-angeles-chargers", LAR: "los-angeles-rams",
    LV: "las-vegas-raiders", MIA: "miami-dolphins", MIN: "minnesota-vikings",
    NE: "new-england-patriots", NO: "new-orleans-saints", NYG: "new-york-giants",
    NYJ: "new-york-jets", PHI: "philadelphia-eagles", PIT: "pittsburgh-steelers",
    SEA: "seattle-seahawks", SF: "san-francisco-49ers", TB: "tampa-bay-buccaneers",
    TEN: "tennessee-titans", WAS: "washington-commanders",
  };
  const teams = (market.matchup ?? "")
    .split(/[^A-Za-z]+/)
    .map((team) => team.toUpperCase())
    .map((team) => (team === "WSH" ? "WAS" : team === "JAC" ? "JAX" : team))
    .filter((team) => Boolean(teamSlugs[team]));

  for (const team of teams) {
    try {
      const rows = rowsFromHtml(
        await fetchText(
          `https://www.numberfire.com/external/widgets/teams/${teamSlugs[team]}`,
        ),
      );
      for (const cells of rows) {
        if (!namesMatch(cells[0] ?? "", target)) continue;

        let value: number | null = null;
        const passScores = (cells[2] ?? "").split("/").map(toNumber);
        if (market.family === "passing_yards") value = toNumber(cells[1]);
        else if (market.family === "passing_touchdowns") value = passScores[0] ?? null;
        else if (market.family === "passing_interceptions") value = passScores[1] ?? null;
        else if (market.family === "rushing_yards") value = toNumber(cells[3]);
        else if (market.family === "rushing_touchdowns") value = toNumber(cells[4]);
        else if (market.family === "receptions") value = toNumber(cells[5]);
        else if (market.family === "receiving_yards") value = toNumber(cells[6]);
        else if (market.family === "receiving_touchdowns") value = toNumber(cells[7]);
        else if (market.family === "touchdowns") {
          const rushing = toNumber(cells[4]) ?? 0;
          const receiving = toNumber(cells[7]) ?? 0;
          value = rushing + receiving;
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
      const position = cells[2]?.toUpperCase();
      mergeStats(map, player, {
        position: ["QB", "RB", "WR", "TE"].includes(position ?? "")
          ? (position as "QB" | "RB" | "WR" | "TE")
          : undefined,
        passingYards: toNumber(cells[7]) ?? undefined,
        rushingYards: toNumber(cells[8]) ?? undefined,
        receptions: toNumber(cells[9]) ?? undefined,
        receivingYards: toNumber(cells[10]) ?? undefined,
        totalTouchdowns:
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

export type ProjectionStatistic =
  | "passing_yards"
  | "passing_touchdowns"
  | "passing_interceptions"
  | "rushing_yards"
  | "rushing_touchdowns"
  | "receptions"
  | "receiving_yards"
  | "receiving_touchdowns"
  | "touchdowns";

export interface WeeklyProjectionStatSnapshot {
  source: ProjectionSource;
  playerName: string;
  playerKey: string;
  statistic: ProjectionStatistic;
  value: number;
}

function activeSourceMap(
  source: (typeof ACTIVE_PROJECTION_SOURCES)[number],
  season: number,
  week: number,
) {
  if (source === "fantasypros") return loadFantasyPros(season, week);
  if (source === "numberfire") return loadNumberFire(season, week);
  if (source === "espn") return loadEspn(season, week);
  if (source === "cbs") return loadCbs(season, week);
  if (source === "rotoballer") return loadRotoBaller(season, week);
  if (source === "covers") return loadCovers(season, week);
  if (source === "dimers") return loadDimers(season, week);
  return loadSleeper(season, week);
}

function plausibleStatProjection(statistic: ProjectionStatistic, value: number) {
  if (!Number.isFinite(value) || value < 0) return false;
  if (statistic === "passing_yards") return value <= 600;
  if (statistic === "passing_touchdowns") return value <= 6;
  if (statistic === "passing_interceptions") return value <= 5;
  if (statistic === "rushing_yards") return value <= 300;
  if (statistic === "rushing_touchdowns") return value <= 3;
  if (statistic === "receptions") return value <= 20;
  if (statistic === "receiving_yards") return value <= 300;
  return value <= 3;
}

export async function getWeeklyProjectionStatSnapshots(
  season: number,
  week: number,
) {
  const settled = await Promise.allSettled(
    ACTIVE_PROJECTION_SOURCES.map(async (source) => ({
      source,
      map: await activeSourceMap(source, season, week),
    })),
  );

  const snapshots: WeeklyProjectionStatSnapshot[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const { source, map } = result.value;

    for (const [playerKey, stats] of map.entries()) {
      const fields: Array<[ProjectionStatistic, number | undefined]> = [];
      if (stats.totalTouchdowns !== undefined) {
        fields.push(["touchdowns", stats.totalTouchdowns]);
      }

      if (stats.position === "QB") {
        fields.push(
          ["passing_yards", stats.passingYards],
          ["passing_touchdowns", stats.passingTouchdowns],
          ["passing_interceptions", stats.passingInterceptions],
          ["rushing_yards", stats.rushingYards],
          ["rushing_touchdowns", stats.rushingTouchdowns],
        );
      } else if (stats.position === "RB") {
        fields.push(
          ["rushing_yards", stats.rushingYards],
          ["rushing_touchdowns", stats.rushingTouchdowns],
          ["receptions", stats.receptions],
          ["receiving_yards", stats.receivingYards],
          ["receiving_touchdowns", stats.receivingTouchdowns],
        );
      } else if (stats.position === "WR" || stats.position === "TE") {
        fields.push(
          ["receptions", stats.receptions],
          ["receiving_yards", stats.receivingYards],
          ["receiving_touchdowns", stats.receivingTouchdowns],
          ["rushing_yards", stats.rushingYards],
          ["rushing_touchdowns", stats.rushingTouchdowns],
        );
      }

      for (const [statistic, value] of fields) {
        if (value === undefined || !plausibleStatProjection(statistic, value)) {
          continue;
        }
        snapshots.push({
          source,
          playerName: playerKey,
          playerKey,
          statistic,
          value,
        });
      }
    }
  }

  return snapshots;
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
  source: ActiveProjectionSource,
  market: CanonicalMarket,
  season: number,
  week: number,
): Promise<ProjectionPoint | null> {
  const map = await activeSourceMap(source, season, week);
  // Prefer an exact normalized player name. Abbreviated fallbacks are used
  // only when they identify exactly one player, so B. Robinson can never
  // silently map Brian Robinson Jr. to Bijan Robinson.
  const found = resolveProjectionPlayer([...map.entries()], market.subject);
  let fallback = found ?? undefined;
  if (!fallback && source === "fantasypros") {
    fallback = (await fantasyProsMarketStats(market, week)) ?? undefined;
  }
  const value = sourceValue(fallback, market.family);
  if ((value === null || !Number.isFinite(value) || value < 0) && source === "numberfire") {
    const point = await numberFireMarketProjection(market);
    if (!point) return null;
    return observeProjectionPoint({
      source,
      subject: market.subject,
      family: market.family,
      season,
      week,
      value: point.value,
    });
  }
  if (value === null || !Number.isFinite(value) || value < 0) return null;

  return observeProjectionPoint({
    source,
    subject: market.subject,
    family: market.family,
    season,
    week,
    value,
    position: fallback?.position,
  });
}

function plausibleProjection(
  family: CanonicalMarket["family"],
  value: number,
) {
  if (!Number.isFinite(value) || value < 0) return false;
  if (family === "passing_yards") return value <= 600;
  if (family === "passing_touchdowns") return value <= 6;
  if (family === "passing_interceptions") return value <= 5;
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
  const sources: readonly ActiveProjectionSource[] = ACTIVE_PROJECTION_SOURCES;
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
      position: null,
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

  const positionWeights = new Map<string, number>();
  for (const item of availableWeights) {
    if (!item.point.position) continue;
    positionWeights.set(
      item.point.position,
      (positionWeights.get(item.point.position) ?? 0) + item.weight,
    );
  }
  const position =
    [...positionWeights.entries()].toSorted(
      (first, second) => second[1] - first[1],
    )[0]?.[0] ?? null;

  return {
    projection,
    points,
    dispersion: points.length > 1 ? Math.sqrt(variance) : null,
    sourceWeights: learned?.weights ?? null,
    weightWeek: learned?.effectiveWeek ?? null,
    position: position as "QB" | "RB" | "WR" | "TE" | null,
  };
}

export function getExternalProjectionConsensus(
  market: CanonicalMarket,
  week: number | null,
  season = 2026,
) {
  if (week === null || !Number.isInteger(week) || week < 1) {
    return Promise.resolve({
      projection: null,
      points: [] as ProjectionPoint[],
      dispersion: null,
      sourceWeights: null,
      weightWeek: null,
      position: null,
    });
  }

  const resolvedWeek = week;
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
